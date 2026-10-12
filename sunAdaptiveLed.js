const COORDINATES = {
  latitude: 50.187,
  longitude: 14.663,
};

const LED_HUE = [100, 50, 0];
const LED_CHECK_INTERVAL = 120e3;
const SUNSET_OFFSET = 1;
const SUNRISE_OFFSET = 0;

function getCzechTimeZoneOffsetHours(currentDate) {
  const monthIndex = currentDate.getMonth();
  const dayOfMonth = currentDate.getDate();

  if (monthIndex > 2 && monthIndex < 8) {
    return 2;
  }

  if (monthIndex < 2 || monthIndex > 8) {
    return 1;
  }

  if (monthIndex === 2) {
    const lastDayOfMarch = new Date(currentDate.getFullYear(), 2, 31);
    const lastSundayOfMarch = 31 - lastDayOfMarch.getDay();
    return dayOfMonth >= lastSundayOfMarch ? 2 : 1;
  }

  if (monthIndex === 9) {
    const lastDayOfOctober = new Date(currentDate.getFullYear(), 9, 31);
    const lastSundayOfOctober = 31 - lastDayOfOctober.getDay();
    return dayOfMonth < lastSundayOfOctober ? 2 : 1;
  }

  return 1;
}

function calculateSunData(currentSystemTime) {
  const startOfYear = new Date(currentSystemTime.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((currentSystemTime - startOfYear) / (1000 * 60 * 60 * 24));

  const degreeToRadianFactor = Math.PI / 180;
  const solarDeclinationAngle = 23.45 * Math.sin(degreeToRadianFactor * ((360 * (284 + dayOfYear)) / 365));

  const latitudeInRadians = COORDINATES.latitude * degreeToRadianFactor;
  const declinationInRadians = solarDeclinationAngle * degreeToRadianFactor;
  const cosineHourAngle = Math.min(Math.max(-Math.tan(latitudeInRadians) * Math.tan(declinationInRadians), -1), 1);

  const hourAngle = Math.acos(cosineHourAngle) / degreeToRadianFactor;
  const solarNoonUTC = 12 - COORDINATES.longitude / 15;
  const timeZoneOffsetHours = getCzechTimeZoneOffsetHours(currentSystemTime);

  return {
    sunriseDecimalHour: solarNoonUTC - hourAngle / 15 + timeZoneOffsetHours,
    sunsetDecimalHour: solarNoonUTC + hourAngle / 15 + timeZoneOffsetHours,
  };
}

function getBrightness(hoursElapsedSinceSunset, hoursRemainingUntilSunrise) {
  if (hoursElapsedSinceSunset <= 2 || hoursRemainingUntilSunrise <= 2) {
    return 35;
  }

  return 100;
}

function toggleLed(options) {
  Shelly.call(
    "PLUGPM_UI.SetConfig",
    {
      config: {
        leds: {
          mode: options.isOn ? "switch" : "off",
          colors: {
            "pm1:0": {
              on: {
                rgb: LED_HUE,
                brightness: options.brightness || 0,
              },
            },
          },
        },
      },
    },
    null
  );
}

function evaluateSunStateAndAdjustPlug() {
  Shelly.call("Sys.GetStatus", {}, function (systemStatusResponse, errorCode) {
    if (errorCode !== 0) {
      return;
    }

    const currentSystemTime = new Date(systemStatusResponse.unixtime * 1000);
    const currentDecimalHour =
      currentSystemTime.getHours() + currentSystemTime.getMinutes() / 60 + currentSystemTime.getSeconds() / 3600;

    const sunData = calculateSunData(currentSystemTime);
    const sunsetDecimalHour = sunData.sunsetDecimalHour + SUNSET_OFFSET;
    const sunriseDecimalHour = sunData.sunriseDecimalHour + SUNRISE_OFFSET;

    let isNightTimeActive;
    let effectiveDecimalHour = currentDecimalHour;
    let effectiveSunriseHour = sunriseDecimalHour;

    if (currentDecimalHour >= sunsetDecimalHour) {
      isNightTimeActive = true;
      effectiveSunriseHour = sunriseDecimalHour + 24;
    } else if (currentDecimalHour <= sunriseDecimalHour) {
      isNightTimeActive = true;
      effectiveDecimalHour = currentDecimalHour + 24;
      effectiveSunriseHour = sunriseDecimalHour + 24;
    } else {
      isNightTimeActive = false;
    }

    if (!isNightTimeActive) {
      toggleLed({ isOn: false });

      return;
    }

    const hoursElapsedSinceSunset = effectiveDecimalHour - sunsetDecimalHour;
    const hoursRemainingUntilSunrise = effectiveSunriseHour - effectiveDecimalHour;

    if (hoursRemainingUntilSunrise <= 0) {
      toggleLed({ isOn: false });

      return;
    }

    const calculatedBrightness = Math.round(getBrightness(hoursElapsedSinceSunset, hoursRemainingUntilSunrise));

    toggleLed({
      isOn: true,
      brightness: calculatedBrightness,
    });
  });
}

Timer.set(LED_CHECK_INTERVAL, true, function () {
  evaluateSunStateAndAdjustPlug();
});

evaluateSunStateAndAdjustPlug();
