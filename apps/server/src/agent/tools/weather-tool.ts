import { tool } from "ai";
import z from "zod";

const getWeatherByCity = ({ city }: { city: string }) => {
  switch (city) {
    case "madrid": {
      return "Sunny and dry with a light breeze.";
    }
    case "new york": {
      return "Cloudy with occasional light rain.";
    }
    case "poznan": {
      return "Cool and overcast with a chance of drizzle.";
    }
    default: {
      return "Passed city is currently unsupported by this tool.";
    }
  }
};

export const getWeather = tool({
  description: "Get the weather for a location",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
  execute: getWeatherByCity,
});
