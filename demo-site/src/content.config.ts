/** The legal documents, written in Markdown in src/content/. */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const legal = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content' }),
  schema: z.object({ title: z.string(), updated: z.string(), intro: z.string() }),
});

export const collections = { legal };
