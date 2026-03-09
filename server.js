import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import {
  transcribeAudio,
  transcribeWithTimestamps,
  transcribeLongAudio,
  convertToWav,
} from "./services/transcribe.js";
import { transcriptionQueue } from "./services/queue.js";

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── Health Check ───
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "transcription-service" });
});

// ─── Part 1: Basic Transcription ───
// Accepts audio file, returns plain text transcription
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided" });
  }

  try {
    const filePath = req.file.path;

    // Convert to WAV if needed (handles different audio formats)
    const processedPath = await convertToWav(filePath);

    const text = await transcribeAudio(processedPath);
    const processedText = text.toLowerCase();

    // Cleanup
    fs.unlinkSync(filePath);
    if (processedPath !== filePath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }

    res.json({
      transcription: text,
      processed: processedText,
    });
  } catch (error) {
    console.error("Transcription error:", error.message);
    res.status(500).json({ error: "Transcription failed", details: error.message });
  }
});

// ─── Part 2: Transcription with Timestamps ───
// Returns transcription with start/end timestamps per segment
app.post("/transcribe/timestamps", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided" });
  }

  try {
    const filePath = req.file.path;
    const processedPath = await convertToWav(filePath);
    const result = await transcribeWithTimestamps(processedPath);

    // Cleanup
    fs.unlinkSync(filePath);
    if (processedPath !== filePath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }

    res.json(result);
  } catch (error) {
    console.error("Transcription error:", error.message);
    res.status(500).json({ error: "Transcription failed", details: error.message });
  }
});

// ─── Part 3: Long Audio Transcription (Chunked) ───
// Splits long audio into chunks, transcribes each with retry, merges results
app.post("/transcribe/long", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided" });
  }

  try {
    const filePath = req.file.path;
    const processedPath = await convertToWav(filePath);
    const result = await transcribeLongAudio(processedPath);

    // Cleanup
    fs.unlinkSync(filePath);
    if (processedPath !== filePath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }

    res.json(result);
  } catch (error) {
    console.error("Transcription error:", error.message);
    res.status(500).json({ error: "Transcription failed", details: error.message });
  }
});

// ─── Part 4: Async Transcription (Queue-based for Concurrent Uploads) ───
// Enqueues the transcription job and returns a job ID immediately
app.post("/transcribe/async", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided" });
  }

  const filePath = req.file.path;

  const jobId = transcriptionQueue.enqueue(filePath, async () => {
    const processedPath = await convertToWav(filePath);
    const result = await transcribeLongAudio(processedPath);

    // Cleanup
    try { fs.unlinkSync(filePath); } catch {}
    if (processedPath !== filePath) {
      try { fs.unlinkSync(processedPath); } catch {}
    }

    return result;
  });

  res.status(202).json({
    message: "Transcription job queued",
    jobId,
    statusUrl: `/status/${jobId}`,
  });
});

// ─── Job Status Endpoint ───
app.get("/status/:id", (req, res) => {
  const job = transcriptionQueue.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

// ─── Start Server ───
app.listen(PORT, () => {
  console.log(`Transcription service running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /transcribe          - Basic transcription`);
  console.log(`  POST /transcribe/timestamps - Transcription with timestamps`);
  console.log(`  POST /transcribe/long     - Long audio (chunked)`);
  console.log(`  POST /transcribe/async    - Async queued transcription`);
  console.log(`  GET  /status/:id          - Check async job status`);
  console.log(`  GET  /health              - Health check`);
});
