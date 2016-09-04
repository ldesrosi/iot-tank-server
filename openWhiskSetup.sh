wsk trigger create startSession
wsk trigger create stopSession
wsk trigger create directionChange
wsk trigger create distanceChange 

wsk package create tank
wsk action create tank/createSession tank-action-0.0.1-SNAPSHOT.jar 
wsk action create tank/move tank-distance-action-0.0.1-SNAPSHOT.jar
wsk action create tank/convertToPayload utils-0.0.1-SNAPSHOT.jar 
