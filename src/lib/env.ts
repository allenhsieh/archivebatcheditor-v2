import { z } from 'zod';

const envSchema = z.object({
  // Archive.org (required)
  ARCHIVE_ACCESS_KEY: z.string().min(1, 'ARCHIVE_ACCESS_KEY is required'),
  ARCHIVE_SECRET_KEY: z.string().min(1, 'ARCHIVE_SECRET_KEY is required'),
  ARCHIVE_EMAIL: z.string().email('ARCHIVE_EMAIL must be a valid email'),

  // YouTube (optional)
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CHANNEL_ID: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .default('http://localhost:3000/api/auth/youtube/callback'),

  // Database
  DATABASE_PATH: z.string().default('./data/app.db'),

  // Runtime
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .filter((i) => i.message.includes('required'))
      .map((i) => i.path.join('.'));
    const invalid = result.error.issues
      .filter((i) => !i.message.includes('required'))
      .map((i) => `${i.path.join('.')}: ${i.message}`);

    if (missing.length > 0) {
      throw new Error(
        `Missing required env vars: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`
      );
    }
    if (invalid.length > 0) {
      console.warn(`⚠️  Invalid env vars:\n  ${invalid.join('\n  ')}`);
    }
  }

  return result.data ?? envSchema.parse(process.env);
}

export const env = loadEnv();
