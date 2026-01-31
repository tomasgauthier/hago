# Tombot v2: Personal AI Assistant

A minimalistic yet powerful personal AI assistant from scratch. Inspired by Moltbot, fixing its over-engineering while keeping its best patterns.

## Features

- **Multi-Model**: Support for Claude, Gemini (Default), OpenAI, and Ollama.
- **Unified Channels**: Integrated with Telegram and WhatsApp.
- **Memory (RAG)**: SQLite-based semantic memory system for long-term knowledge.
- **Tools**: Extendable tool registry (e.g., Web Search).
- **Cron Jobs**: Scheduled automated interactions.
- **Atomic Persistence**: Single SQLite database for sessions, messages, memory, and cron.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (ESM)
- **HTTP**: Hono
- **WhatsApp**: @whiskeysockets/baileys
- **Telegram**: grammy
- **Database**: better-sqlite3

## Setup

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file (see `.env.example`):

   ```env
   GOOGLE_API_KEY=your_key
   TELEGRAM_TOKEN=your_token
   DATA_DIR=./data
   ```

3. **Run Development**:

   ```bash
   npm run dev
   ```

4. **Build and Start**:

   ```bash
   npm run build
   npm start
   ```

## Docker

```bash
docker build -t tombot .
docker run -v $(pwd)/data:/app/data --env-file .env tombot
```
