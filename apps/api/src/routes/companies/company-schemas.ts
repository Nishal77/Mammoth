import { z } from "zod";

export const CreateCompanySchema = z.object({
  name: z.string().min(2).max(100),
  tagline: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  industry: z.string().max(100).optional(),
  stage: z
    .enum(["idea", "pre-revenue", "early-revenue", "growing", "scaling"])
    .optional(),
  website: z.string().url().optional().or(z.literal("")),
  brandVoice: z.string().max(5000).optional(),
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  version: z.number().int().positive(),
});

export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
