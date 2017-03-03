var config = module.exports = {};

config.env = 'dev';
config.SERVER_PORT = '8081';

config.GOOGLE_CLIENT_ID = "894972897599-i2i74fpsh81plg6v934pianelkcf1ogh.apps.googleusercontent.com";
config.GOOGLE_CLIENT_SECRET = "edVtWz93jJ0HxyNlC5eoDNg2"
config.GOOGLE_CALLBACK_URL = "http://localhost:8081/oauth2callback"

config.DOOR_URL_CHECK = "http://redhat:R3dHat123@dus-garage.privatedns.org:8000/dus/garagetest/value"
config.DOOR_TIMEOUT = 2000
config.DOOR_URL_OPEN = "http://redhat:R3dHat123@dus-garage.privatedns.org:8000/dus/garagetest/value/1"

// ------------------------
// CRON Entries. Syntax:
// ss mm hh day month dayOfWeek

// When to reset all lots to "Free":
config.CRON_RESET_LOTS="42 42 4 * * *"

// How often to check door availability:
config.CRON_DOOR_CHECK= "0,10,20,30,40,50 * * * * *"

module.exports = config;
