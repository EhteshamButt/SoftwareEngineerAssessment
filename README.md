# Transcription Service - Software Engineer Assessment

A simple transcription pipeline that converts audio input into text and processes the result for downstream use. Built with Node.js, Express, and OpenAI Whisper API.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Setup & Installation](#setup--installation)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Engineering Decisions](#engineering-decisions)
  - [Handling Different Audio Formats](#handling-different-audio-formats)
  - [Dealing with Long Audio Files](#dealing-with-long-audio-files)
  - [Handling Concurrent Uploads](#handling-concurrent-uploads)
  - [Storing Audio and Transcripts](#storing-audio-and-transcripts)
  - [Retry and Recovery for Failed Transcriptions](#retry-and-recovery-for-failed-transcriptions)
  - [Exposing as an API](#exposing-as-an-api)
- [Project Structure](#project-structure)
- [API Flow Diagram](#api-flow-diagram)

---

## Architecture Overview

```
Client uploads audio file (MP3/WAV/M4A)
        │
        ▼
Express API receives file via Multer
        │
        ▼
Audio converted to WAV 16kHz mono (FFmpeg)
        │
        ▼
Long files split into chunks (10 min each)
        │
        ▼
Each chunk sent to OpenAI Whisper API
  (with retry + exponential backoff)
        │
        ▼
Results merged with adjusted timestamps
        │
        ▼
JSON response returned to client
```

## Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js** | Runtime environment |
| **Express.js** | HTTP server and routing |
| **Multer** | File upload handling (multipart/form-data) |
| **OpenAI SDK** | Whisper speech-to-text API |
| **FFmpeg** | Audio format conversion and chunking |
| **dotenv** | Environment variable management |
| **uuid** | Unique job ID generation |

## Setup & Installation

### Prerequisites

- Node.js (v18 or higher)
- FFmpeg installed and available in PATH (optional, for format conversion and chunking)
- OpenAI API key

### Installation

```bash
# Clone or navigate to the project directory
cd SoftwareEngineerAssessment

# Install dependencies
npm install

# Configure environment variables
# Edit .env and add your OpenAI API key
```

### Environment Variables

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

### Running the Server

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server will start on `http://localhost:3000`.

---

## API Endpoints

### 1. Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "service": "transcription-service"
}
```

### 2. Basic Transcription

```
POST /transcribe
Content-Type: multipart/form-data
```

Accepts an audio file and returns plain text transcription.

**Request:** Form-data with field `audio` containing the audio file.

**Response:**
```json
{
  "transcription": "Hello world, this is a test recording.",
  "processed": "hello world, this is a test recording."
}
```

### 3. Transcription with Timestamps

```
POST /transcribe/timestamps
Content-Type: multipart/form-data
```

Returns transcription with start/end timestamps per segment.

**Response:**
```json
{
  "full_text": "Hello world, this is a test recording.",
  "segments": [
    { "start": 0.0, "end": 2.5, "text": "Hello world," },
    { "start": 2.5, "end": 5.1, "text": " this is a test recording." }
  ]
}
```

### 4. Long Audio Transcription (Chunked)

```
POST /transcribe/long
Content-Type: multipart/form-data
```

Splits long audio into 10-minute chunks, transcribes each with retry logic, and merges results.

**Response:**
```json
{
  "full_text": "Full merged transcription text...",
  "segments": [
    { "start": 0.0, "end": 5.2, "text": "First segment..." },
    { "start": 600.0, "end": 605.3, "text": "Segment from second chunk..." }
  ],
  "chunks_processed": 3
}
```

### 5. Async Transcription (Queue-based)

```
POST /transcribe/async
Content-Type: multipart/form-data
```

Enqueues the transcription job and returns a job ID immediately. Useful for large files or high concurrency.

**Response (202 Accepted):**
```json
{
  "message": "Transcription job queued",
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "statusUrl": "/status/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### 6. Check Job Status

```
GET /status/:id
```

**Response (pending):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "processing",
  "result": null,
  "error": null,
  "createdAt": "2026-03-09T12:00:00.000Z",
  "completedAt": null
}
```

**Response (completed):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "result": {
    "full_text": "Transcribed text...",
    "segments": [...],
    "chunks_processed": 1
  },
  "error": null,
  "createdAt": "2026-03-09T12:00:00.000Z",
  "completedAt": "2026-03-09T12:00:15.000Z"
}
```

---

## Usage Examples

```bash
# Basic transcription
curl -X POST http://localhost:3000/transcribe \
  -F "audio=@speech.mp3"

# Transcription with timestamps
curl -X POST http://localhost:3000/transcribe/timestamps \
  -F "audio=@recording.wav"

# Long audio file (chunked processing)
curl -X POST http://localhost:3000/transcribe/long \
  -F "audio=@lecture.mp3"

# Async transcription (returns immediately with job ID)
curl -X POST http://localhost:3000/transcribe/async \
  -F "audio=@podcast.mp3"

# Check job status
curl http://localhost:3000/status/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## Engineering Decisions

### Handling Different Audio Formats

The service accepts any audio format (MP3, WAV, M4A, OGG, FLAC, etc.) and automatically converts it to a standardized format before transcription:

1. **Check** whether the uploaded file is a supported audio type.
2. **Convert** to WAV 16kHz mono using FFmpeg for consistency.
3. **Send** the standardized file to the Whisper speech-to-text engine.

This ensures compatibility regardless of what format the client uploads. If FFmpeg is not installed, the service falls back to sending the original file directly to Whisper (which natively supports MP3, WAV, M4A, WEBM, and MP4).

### Dealing with Long Audio Files

For long audio files, the service chunks the audio into smaller segments before transcription:

1. **Split** the audio into 10-minute chunks using FFmpeg.
2. **Transcribe** each chunk separately using the Whisper API.
3. **Merge** the transcriptions in order, adjusting timestamps per chunk so they remain accurate relative to the original file.
4. **Retry** failed chunks individually with exponential backoff (2s, 4s, 8s) to avoid losing progress.

This approach prevents:
- Memory issues from loading large files entirely into memory.
- API timeouts (Whisper has a 25MB file size limit).
- Lost progress — if one chunk fails, only that chunk is retried.

### Handling Concurrent Uploads

The service handles concurrent uploads through multiple mechanisms:

1. **Async/Await** — Each upload is processed independently without blocking the Node.js event loop.
2. **Job Queue** — An in-memory queue with a configurable concurrency limit (default: 3 simultaneous transcriptions) prevents overloading the server or hitting API rate limits.
3. **Isolated Storage** — Each uploaded file gets a unique filename from Multer, preventing file conflicts.
4. **Async Endpoint** — The `/transcribe/async` endpoint returns immediately with a job ID, allowing clients to poll `/status/:id` for results.

For production at scale, the in-memory queue would be replaced with BullMQ or RabbitMQ, and the service would run behind a load balancer with multiple Node.js instances.

### Storing Audio and Transcripts

Current implementation uses temporary file storage with cleanup after processing. For a production system:

**Audio Storage:**
- Use object storage (AWS S3, Google Cloud Storage, or Azure Blob Storage) for scalable, durable file storage.
- File naming with UUIDs and timestamps: `uploads/2026-03-10/user123/uuid.mp3`.

**Transcript Storage:**
- **Relational DB (PostgreSQL)** for structured queries:
  ```
  id | user_id | audio_url | transcript_text | created_at
  ```
- **NoSQL (MongoDB)** for flexible segment storage:
  ```json
  {
    "userId": 123,
    "audioUrl": "s3://bucket/file1.mp3",
    "transcript": "Hello world...",
    "segments": [
      { "start": 0.0, "end": 5.2, "text": "Hello" }
    ]
  }
  ```

**Linking:** Audio URL stored in the same record as the transcript for easy retrieval.

### Retry and Recovery for Failed Transcriptions

The service implements a multi-layered retry strategy:

1. **Exponential Backoff** — Retries after 2s, 4s, 8s (max 3 attempts) for transient errors like network timeouts or temporary API failures.
2. **Per-Chunk Retry** — For long audio, only failed chunks are retried, not the entire file.
3. **Error Logging** — All failures are logged with metadata (file path, error message, timestamp) for debugging.
4. **Job Status Tracking** — Async jobs maintain status (`pending` → `processing` → `completed` / `failed`) so clients can monitor progress and detect failures.

For production enhancements:
- Circuit breaker pattern to stop retries when the API is down.
- Dead letter queue for permanently failed jobs.
- Admin alerts for repeated failures.

### Exposing as an API

The service is exposed as a RESTful API with these design principles:

| Principle | Implementation |
|---|---|
| **File Upload** | Multer for streaming multipart/form-data |
| **Sync Processing** | `/transcribe` for small files with immediate response |
| **Async Processing** | `/transcribe/async` with job queue and `/status/:id` polling |
| **Error Handling** | Structured JSON errors with status codes |
| **Validation** | File presence check before processing |
| **Cleanup** | Temp files deleted after processing |

---

## Project Structure

```
SoftwareEngineerAssessment/
├── .env                      # Environment variables (API key, port)
├── .gitignore                # Ignores node_modules, uploads, .env
├── package.json              # Dependencies and scripts
├── server.js                 # Express server with all API routes
├── services/
│   ├── transcribe.js         # Whisper transcription, chunking, retry logic
│   └── queue.js              # In-memory job queue for concurrent uploads
└── uploads/                  # Temporary file storage (auto-cleaned)
```

---

## API Flow Diagram

```
┌────────┐     POST /transcribe      ┌──────────────┐
│ Client │ ─────────────────────────► │  Express API  │
│        │     (audio file)          │   (Multer)    │
└────────┘                           └──────┬───────┘
                                            │
                                            ▼
                                    ┌───────────────┐
                                    │ Format Check   │
                                    │ + Convert WAV  │
                                    │   (FFmpeg)     │
                                    └──────┬────────┘
                                           │
                              ┌────────────┴────────────┐
                              │ File > 10 min?          │
                              ├─── No ──┐    ┌── Yes ───┤
                              │         │    │          │
                              │         ▼    ▼          │
                              │    ┌─────────────┐      │
                              │    │ Split into   │      │
                              │    │ 10-min chunks│      │
                              │    └──────┬──────┘      │
                              │           │             │
                              ▼           ▼             │
                        ┌──────────────────────┐        │
                        │   OpenAI Whisper API  │        │
                        │   (with retry logic)  │        │
                        └──────────┬───────────┘        │
                                   │                    │
                                   ▼                    │
                        ┌──────────────────────┐        │
                        │ Merge transcriptions  │◄───────┘
                        │ + adjust timestamps   │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  JSON Response        │
                        │  {text, segments}     │
                        └──────────────────────┘


Concurrent Upload Flow:

┌──────────┐
│ Client 1 │──┐
└──────────┘  │     ┌─────────────┐     ┌───────────────┐
┌──────────┐  ├────►│  Job Queue   │────►│  Worker Pool  │
│ Client 2 │──┤     │ (max 3 jobs) │     │  (3 parallel) │
└──────────┘  │     └─────────────┘     └───────┬───────┘
┌──────────┐  │                                 │
│ Client 3 │──┘           ┌─────────────────────┘
└──────────┘              ▼
                  ┌───────────────┐
                  │ GET /status/id │◄── Poll for results
                  └───────────────┘
```
