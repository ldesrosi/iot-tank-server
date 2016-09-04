package com.ibm.openwhisk.tank;

import com.google.gson.JsonObject;

public class StartSessionAction {
    public static JsonObject main(JsonObject input) {   	
    	if (!input.has("strategy")) return null;
    	
    	JsonObject result = new JsonObject();
    	result.addProperty("command", "startSession");
    	result.addProperty("sessionId", System.currentTimeMillis());
    	result.addProperty("strategy", input.get("strategy").getAsString());
     	
    	return result;
    }
}
