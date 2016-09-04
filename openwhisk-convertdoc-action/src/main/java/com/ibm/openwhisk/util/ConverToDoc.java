package com.ibm.openwhisk.util;

import com.google.gson.JsonObject;

public class ConverToDoc {
    public static JsonObject main(JsonObject input) {
	    JsonObject response = new JsonObject();
	    response.addProperty("doc", input.toString());
	    return response;
    }
}
