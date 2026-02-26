import z from "zod";

const WEATHER_DESCRIPTION_BY_CITY = {
  madrid: "Sunny and dry with a light breeze.",
  "new york": "Cloudy with occasional light rain.",
  poznan: "Cool and overcast with a chance of drizzle.",
} as const;

export const getWeatherByCityTool = (city: string) => {
  const parseResult = z.enum(Object.keys(WEATHER_DESCRIPTION_BY_CITY)).safeParse(city);

  if (parseResult.success) {
    return WEATHER_DESCRIPTION_BY_CITY[parseResult.data];
  }

  return "Passed city is currently unsupported by this tool.";
};
