package com.ibm.openwhisk.util;

import com.google.gson.JsonObject;

public class ConverToPayload {
    public static JsonObject main(JsonObject input) {
	    JsonObject response = new JsonObject();
	    response.addProperty("payload", input.toString());
	    return response;
    }
}
