const express = require("express");
const dotenv = require("dotenv");
const crypto = require("crypto");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const jobs = new Map();

function splitStory(text) {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?۔])\s+|\n+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function createPrompt(scene, style, voice) {
  return `
Create an 8-second children's animated video.

Story scene:
${scene}

Visual style:
${style}

Voice:
${voice}

Requirements:
- Colorful child-friendly animation
- Clear characters and expressions
- Smooth camera movement
- No watermark
- No text on screen
- Generate native audio
- Narration/dialogue should be in Roman Urdu
- Keep the scene family friendly
`;
}

async function generateVeoVideo(prompt, aspectRatio) {

  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt
          }
        ],
        parameters: {
          aspectRatio: aspectRatio || "16:9",
          resolution: "720p",
          numberOfVideos: 1
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Veo API request failed."
    );
  }

  if (!data.name) {
    throw new Error("Veo operation ID was not returned.");
  }

  const operationName = data.name;

  for (let i = 0; i < 120; i++) {

    await new Promise(resolve =>
      setTimeout(resolve, 10000)
    );

    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      {
        headers: {
          "x-goog-api-key": API_KEY
        }
      }
    );

    const status = await statusResponse.json();

    if (!statusResponse.ok) {
      throw new Error(
        status?.error?.message ||
        "Could not check video status."
      );
    }

    if (status.done === true) {

      if (status.error) {
        throw new Error(
          status.error.message ||
          "Video generation failed."
        );
      }

      const videoUri =
        status?.response
          ?.generateVideoResponse
          ?.generatedSamples?.[0]
          ?.video?.uri;

      if (!videoUri) {
        throw new Error(
          "Generated video URL was not returned."
        );
      }

      const videoResponse = await fetch(
        videoUri,
        {
          headers: {
            "x-goog-api-key": API_KEY
          }
        }
      );

      if (!videoResponse.ok) {
        throw new Error(
          "Generated video download failed."
        );
      }

      return Buffer.from(
        await videoResponse.arrayBuffer()
      );
    }
  }

  throw new Error(
    "Video generation timed out."
  );
}

async function processJob(jobId, options) {

  const job = jobs.get(jobId);

  try {

    job.status = "generating";

    const scenes = splitStory(options.story);

    if (!scenes.length) {
      throw new Error("No scenes found.");
    }

    job.total = scenes.length;

    /*
      For the first working version we generate
      the scenes one by one.
    */

    for (let i = 0; i < scenes.length; i++) {

      job.currentScene = i + 1;

      const prompt = createPrompt(
        scenes[i],
        options.style,
        options.voice
      );

      await generateVeoVideo(
        prompt,
        options.aspectRatio
      );

      job.progress = Math.round(
        ((i + 1) / scenes.length) * 100
      );
    }

    job.status = "completed";

  } catch (error) {

    console.error(error);

    job.status = "error";
    job.error =
      error.message ||
      "Something went wrong.";
  }
}

app.post("/api/generate", (req, res) => {

  if (!API_KEY) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEY is missing. Add your API key in the server environment."
    });
  }

  const {
    story,
    style,
    voice,
    aspectRatio
  } = req.body;

  if (!story || story.trim().length < 5) {
    return res.status(400).json({
      error: "Please enter a story."
    });
  }

  const jobId = crypto.randomUUID();

  jobs.set(jobId, {
    id: jobId,
    status: "queued",
    progress: 0,
    currentScene: 0,
    total: 0,
    error: null
  });

  processJob(jobId, {
    story: story.trim(),
    style: style || "Colorful 3D cartoon",
    voice: voice || "Friendly storyteller",
    aspectRatio: aspectRatio || "16:9"
  });

  res.json({
    success: true,
    jobId
  });
});

app.get("/api/status/:id", (req, res) => {

  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      error: "Job not found."
    });
  }

  res.json(job);
});

app.get("/api/health", (req, res) => {

  res.json({
    status: "online",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

app.listen(PORT, () => {

  console.log(
    `NIAZI AI VIDEO MAKER running on port ${PORT}`
  );

});
