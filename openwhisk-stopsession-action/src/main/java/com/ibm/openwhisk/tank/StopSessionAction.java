package com.ibm.openwhisk.tank;

import com.google.gson.JsonObject;

public class StopSessionAction {
    public static JsonObject main(JsonObject input) {   	
    	JsonObject result = new JsonObject();
    	result.addProperty("command", "stopSession");
    	result.addProperty("sessionId", input.get("sessionId").getAsLong());
     	
    	return result;
    }
}
