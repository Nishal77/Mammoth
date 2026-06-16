import { z } from "zod";

/**
 * Standard API response envelope for all endpoints.
 * Either data or error is non-null, never both.
 */
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: z
      .object({
        message: z.string(),
        code: z.string(),
      })
      .nullable(),
  });

export type ApiResponse<T> = {
  data: T | null;
  error: { message: string; code: string } | null;
};

export function successResponse<T>(data: T): ApiResponse<T> {
  return { data, error: null };
}

export function errorResponse(
  message: string,
  code: string
): ApiResponse<never> {
  return { data: null, error: { message, code } };
}

// Pagination
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};
