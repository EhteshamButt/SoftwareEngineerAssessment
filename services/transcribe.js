import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { exec } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";

const execAsync = promisify(exec);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Whisper API max file size is 25MB
const MAX_CHUNK_DURATION = 600; // 10 minutes per chunk in seconds

/**
 * Transcribe a single audio file using OpenAI Whisper
 */
export async function transcribeAudio(filePath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
  });
  return transcription.text;
}

/**
 * Transcribe with verbose JSON (timestamps per segment)
 */
export async function transcribeWithTimestamps(filePath) {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
  });

  const segments = response.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
  }));

  return {
    full_text: response.text,
    segments,
  };
}

/**
 * Get audio duration using ffprobe
 */
async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    // If ffprobe not available, return 0 (skip chunking)
    return 0;
  }
}

/**
 * Split audio into chunks using ffmpeg
 */
async function splitAudioIntoChunks(filePath, chunkDuration) {
  const ext = path.extname(filePath) || ".wav";
  const chunkDir = path.join("uploads", `chunks_${uuidv4()}`);
  fs.mkdirSync(chunkDir, { recursive: true });

  const duration = await getAudioDuration(filePath);
  if (duration <= 0 || duration <= chunkDuration) {
    return [filePath]; // No splitting needed
  }

  const chunks = [];
  const numChunks = Math.ceil(duration / chunkDuration);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = path.join(chunkDir, `chunk_${i}${ext}`);
    await execAsync(
      `ffmpeg -i "${filePath}" -ss ${startTime} -t ${chunkDuration} -y "${chunkPath}"`
    );
    chunks.push(chunkPath);
  }

  return chunks;
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Handle long audio files by chunking, transcribing each chunk with retry,
 * and merging results
 */
export async function transcribeLongAudio(filePath) {
  const chunks = await splitAudioIntoChunks(filePath, MAX_CHUNK_DURATION);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = chunks[i];
    console.log(`Transcribing chunk ${i + 1}/${chunks.length}...`);

    const result = await withRetry(async () => {
      return await transcribeWithTimestamps(chunkPath);
    });

    // Adjust timestamps for chunks after the first
    if (i > 0) {
      const timeOffset = i * MAX_CHUNK_DURATION;
      result.segments = result.segments.map((seg) => ({
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
        text: seg.text,
      }));
    }

    results.push(result);

    // Clean up chunk file if it's not the original
    if (chunkPath !== filePath) {
      try {
        fs.unlinkSync(chunkPath);
      } catch {}
    }
  }

  // Clean up chunk directory
  if (chunks.length > 1) {
    const chunkDir = path.dirname(chunks[0]);
    try {
      fs.rmdirSync(chunkDir);
    } catch {}
  }

  // Merge all results
  const fullText = results.map((r) => r.full_text).join(" ");
  const allSegments = results.flatMap((r) => r.segments);

  return {
    full_text: fullText,
    segments: allSegments,
    chunks_processed: chunks.length,
  };
}

/**
 * Convert audio to WAV format using ffmpeg (handles different formats)
 */
export async function convertToWav(inputPath) {
  const outputPath = inputPath + ".wav";
  try {
    await execAsync(
      `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -y "${outputPath}"`
    );
    return outputPath;
  } catch {
    // If ffmpeg not available, return original file
    return inputPath;
  }
}
