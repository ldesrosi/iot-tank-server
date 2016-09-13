#!/bin/bash 

source local.env

# Absolute path to this script, e.g. /home/user/bin/foo.sh
SCRIPT=$(readlink -f "$0")
# Absolute path this script is in, thus /home/user/bin
SCRIPTPATH=$(dirname "$SCRIPT")

cd $SCRIPTPATH/openwhisk-convertpayload-action
mvn package

cd $SCRIPTPATH/openwhisk-convertdoc-action
mvn package

cd ../openwhisk-startsession-action
mvn package

cd ../openwhisk-stopsession-action
mvn package

cd ..

wsk trigger create startSession
wsk trigger create stopSession
wsk trigger create directionChange
wsk trigger create distanceChange 

wsk package create tank
wsk action update tank/startSession ./openwhisk-startsession-action/target/startsession-action-0.0.1.jar 
wsk action update tank/stopSession ./openwhisk-stopsession-action/target/stopsession-action-0.0.1.jar
wsk action update tank/convertToPayload ./openwhisk-convertpayload-action/target/utils-0.0.1.jar 
wsk action update tank/convertToDoc ./openwhisk-convertdoc-action/target/utils-cloudant-0.0.1.jar

# we will need to listen to cloudant event
echo "Binding cloudant"
# /whisk.system/cloudant
wsk package bind /whisk.system/cloudant \
  tank-cloudant\
  -p username $CLOUDANT_username\
  -p password $CLOUDANT_password\
  -p host $CLOUDANT_host

wsk package bind /whisk.system/websocket \
  tank-command\
  -p uri ws://iot-tank-bridge.mybluemix.net/tank/command

