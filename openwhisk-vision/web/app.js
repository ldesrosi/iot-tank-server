//------------------------------------------------------------------------------
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------
var
  express = require('express'),
  app = express(),
  multer = require('multer'),
  upload = multer({
    dest: 'uploads/'
  }),
  cfenv = require('cfenv'),
  fs = require("fs"),
  async = require("async");

// Upload areas and reset/delete for videos and images can be protected by basic authentication
// by configuring ADMIN_USERNAME and ADMIN_PASSWORD environment variables.
var
  auth = require('http-auth'),
  basic = auth.basic({
    realm: "Adminstrative Area"
  }, function (username, password, callback) { // Custom authentication method.
    // Authentication is configured through environment variables.
    // If there are not set, upload is open to all users.
    callback(username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD);
  }),
  authenticator = auth.connect(basic),
  checkForAuthentication = function (req, res, next) {
    if (process.env.ADMIN_USERNAME) {
      console.log("Authenticating call...");
      authenticator(req, res, next);
    } else {
      console.log("No authentication configured");
      next();
    }
  };

//---Deployment Tracker---------------------------------------------------------
require("cf-deployment-tracker-client").track();

// initialize local VCAP configuration
var vcapLocal = null
try {
  require('node-env-file')('../local.env');
  vcapLocal = {
    "services": {
      "cloudant": [
        {
          "credentials": {
            "url": "https://" + process.env.CLOUDANT_username + ":" + process.env.CLOUDANT_password + "@" + process.env.CLOUDANT_host
          },
          "label": "cloudant",
          "name": "cloudant-for-iottank"
      }
    ]
    }
  };
  console.log("Loaded local VCAP", vcapLocal);
} catch (e) {
  console.error("local.env file not found.", e);
}

// get the app environment from Cloud Foundry, defaulting to local VCAP
var appEnvOpts = vcapLocal ? {
  vcap: vcapLocal
} : {}
var appEnv = cfenv.getAppEnv(appEnvOpts);

var cloudant = require('nano')(appEnv.getServiceCreds("cloudant-for-iottank").url).db;
var visionDb;
var prepareDbTasks = [];

// create the db
prepareDbTasks.push(
  function (callback) {
    console.log("Creating database...");
    cloudant.create("iot-tank", function (err, body) {
      if (err && err.statusCode == 412) {
        console.log("Database already exists");
        callback(null);
      } else if (err) {
        callback(err);
      } else {
        callback(null);
      }
    });
  });

// use it
prepareDbTasks.push(
  function (callback) {
    console.log("Setting current database to iot-tank...");
    visionDb = cloudant.use("iot-tank");
    callback(null);
  });

// create design documents
var designDocuments = JSON.parse(fs.readFileSync("./database-designs.json"));
designDocuments.docs.forEach(function (doc) {
  prepareDbTasks.push(function (callback) {
    console.log("Creating", doc._id);
    visionDb.insert(doc, function (err, body) {
      if (err && err.statusCode == 409) {
        console.log("Design", doc._id, "already exists");
        callback(null);
      } else if (err) {
        callback(err);
      } else {
        callback(null);
      }
    });
  });
});

async.waterfall(prepareDbTasks, function (err, result) {
  if (err) {
    console.log("Error in database preparation", err);
  }
});

/**
 * Returns an image attachment for a given video or image id,
 * such as the thumbnail for a video or the original data for an image.
 */
app.get("/images/:type/:id.jpg", function (req, res) {
  visionDb.attachment.get(req.params.id, req.params.type + ".jpg").pipe(res);
});

/**
 * Returns all standalone images (images not linked to a video)
 */
app.get("/api/images", function (req, res) {
  visionDb.view("images", "standalone", {
    include_docs: true
  }, function (err, body) {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(body.rows.map(function (doc) {
        return doc.doc
      }));
    }
  });
});

/**
 * Removes the analysis from one image
 */
app.get("/api/images/:id/reset", checkForAuthentication, function (req, res) {
  async.waterfall([
    function (callback) {
      // get the image
      visionDb.get(req.params.id, {
        include_docs: true
      }, function (err, body) {
        callback(err, body);
      });
    },
    function (image, callback) {
      console.log("Removing analysis from image...");
      delete image.analysis;
      visionDb.insert(image, function (err, body, headers) {
        callback(err, body);
      });
    }
    ], function (err, result) {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

/**
 * Deletes a single image
 */
app.delete("/api/images/:id", checkForAuthentication, function (req, res) {
  async.waterfall([
    function (callback) {
      // get the image
      visionDb.get(req.params.id, {
        include_docs: true
      }, function (err, body) {
        callback(err, body);
      });
    },
    function (image, callback) {
      console.log("Deleting image...");
      delete image.analysis;
      visionDb.destroy(image._id, image._rev, function (err, body) {
        callback(err, body);
      });
    }
    ], function (err, result) {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

/**
 * Returns a summary of the results for one video.
 * It collects all images and their analysis and keeps only the most relevants.
 */
app.get("/api/videos/:id/summary", function (req, res) {

  // threshold to decide what tags/labels/faces to keep
  var options = {
    minimumFaceOccurrence: 3,
    minimumFaceScore: 0.85,
    minimumFaceScoreOccurrence: 2,
    minimumLabelOccurrence: 5,
    minimumLabelScore: 0.70,
    minimumLabelScoreOccurrence: 1,
    maximumLabelCount: 5,
    minimumKeywordOccurrence: 1,
    minimumKeywordScore: 0.60,
    minimumKeywordScoreOccurrence: 1,
    maximumKeywordCount: 5
  }

  async.waterfall([
    // get the video document
    function (callback) {
        console.log("Retrieving video", req.params.id);
        visionDb.get(req.params.id, {
          include_docs: true
        }, function (err, body) {
          callback(err, body);
        });
    },
    // get all images for this video
    function (video, callback) {
        console.log("Retrieving images for", video._id);
        visionDb.view("images", "by_video_id", {
          key: video._id,
          include_docs: true
        }, function (err, body) {
          if (err) {
            callback(err);
          } else {
            callback(null, video, body.rows.map(function (doc) {
              return doc.doc
            }));
          }
        });
    },
    // summarize tags, faces
    function (images, callback) {
        // Map faces, keywords, tags to their occurrences.
        // These maps will be used to decide which tags/faces to keep for the video summary
        var peopleNameToOccurrences = {};
        var keywordToOccurrences = {};

        console.log("Sorting analysis");
        images.forEach(function (image) {
          if (image.hasOwnProperty("analysis") && image.analysis.face_detection) {
            image.analysis.face_detection.forEach(function (face) {
              if (face.identity && face.identity.name) {
                if (!peopleNameToOccurrences.hasOwnProperty(face.identity.name)) {
                  peopleNameToOccurrences[face.identity.name] = [];
                }
                peopleNameToOccurrences[face.identity.name].push(face);
                face.image_id = image._id;
                face.image_url = req.protocol + "://" + req.hostname + "/images/image/" + image._id + ".jpg"
                face.timecode = image.frame_timecode;
              }
            });
          }
          
          if (image.hasOwnProperty("analysis") && image.analysis.image_keywords) {
            image.analysis.image_keywords.forEach(function (keyword) {
              if (!keywordToOccurrences.hasOwnProperty(keyword.class)) {
                keywordToOccurrences[keyword.class] = [];
              }
              keywordToOccurrences[keyword.class].push(keyword);
              keyword.image_id = image._id;
              keyword.image_url = req.protocol + "://" + req.hostname + "/images/image/" + image._id + ".jpg"
              keyword.timecode = image.frame_timecode;
            });
          }
        });

        // Filter a list of occurrences according to the minimum requirements
        function filterOccurrences(occurrences, accessor) {
          Object.keys(occurrences).forEach(function (property) {
            // by default we don't keep it
            var keepIt = false;

            // but with enough occurrences
            if (occurrences[property].length >= accessor.minimumOccurrence) {
              // and the minimum score for at least one occurrence
              var numberOfOccurrencesAboveThreshold = 0;
              occurrences[property].forEach(function (occur) {
                if (accessor.score(occur) >= accessor.minimumScore) {
                  numberOfOccurrencesAboveThreshold = numberOfOccurrencesAboveThreshold + 1;
                }
              });

              // we keep it
              if (numberOfOccurrencesAboveThreshold >= accessor.minimumScoreOccurrence) {
                keepIt = true;
              }
            } else {
              keepIt = false;
            }

            if (!keepIt) {
              delete occurrences[property];
            } else {
              // sort the occurrences, higher score first
              occurrences[property].sort(function (oneOccurrence, anotherOccurrence) {
                return accessor.score(anotherOccurrence) - accessor.score(oneOccurrence);
              });

              // keep only the first one
              occurrences[property] = occurrences[property].slice(0, 1);
            }
          });

          var result = [];
          Object.keys(occurrences).forEach(function (property) {
            result.push({
              occurrences: occurrences[property]
            });
          });

          result.sort(function (oneOccurrence, anotherOccurrence) {
            return accessor.score(anotherOccurrence.occurrences[0]) -
              accessor.score(oneOccurrence.occurrences[0]);
          });

          if (accessor.maximumOccurrenceCount && result.length > accessor.maximumOccurrenceCount) {
            result = result.slice(0, accessor.maximumOccurrenceCount);
          }

          return result;
        }

        callback(null, {
          face_detection: peopleNameToOccurrences,
          image_keywords: keywordToOccurrences
        });
    }],
    function (err, result) {
      if (err) {
        res.status(500).send({
          error: err
        });
      } else {
        res.send(result);
      }
    });
});

/**
 * Returns an overview of the current state of the processing
 * by looking at the content of the database.
 */
app.get("/api/status", function (req, res) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  var status = {
    images: {}
  }

  async.parallel([
    function (callback) {
      visionDb.view("images", "all", function (err, body) {
        if (body) {
          status.images.count = body.total_rows;
        }
        callback(null);
      });
    },
    function (callback) {
      visionDb.view("images", "to_be_analyzed", function (err, body) {
        if (body) {
          status.images.to_be_analyzed = body.total_rows;
        }
        callback(null);
      });
    }
  ], function (err, result) {
    res.send(status);
  });
});

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

// start server on the specified port and binding host
app.listen(appEnv.port, "0.0.0.0", function () {
  // print a message when the server starts listening
  console.log("server starting on " + appEnv.url);
});
