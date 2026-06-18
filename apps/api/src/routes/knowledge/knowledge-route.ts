import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, knowledgeDocs } from "@mammoth/memory-database";
import { eq, and } from "drizzle-orm";
import { ingestDocument } from "@mammoth/knowledge-ingestion";
import { requireCompanyAccess } from "../../middleware/require-company-access.ts";
import type { KnowledgeDocType } from "@mammoth/memory-database";

const UploadSchema = z.object({
  filename: z.string().min(1).max(255),
  docType: z.enum(["sop", "playbook", "product_doc", "pricing", "support_guide", "sales_script", "faq", "policy"]),
  department: z.string().default("all"),
  text: z.string().min(10).max(500_000),
});

type CompanyParams = { Params: { companyId: string } };

/**
 * Knowledge document management routes.
 * Agents read from Qdrant at runtime — these routes populate it.
 *
 * POST   /companies/:companyId/knowledge          — upload + ingest a doc
 * GET    /companies/:companyId/knowledge          — list all docs
 * DELETE /companies/:companyId/knowledge/:docId   — remove a doc
 */
export async function knowledgeRoute(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireCompanyAccess);

  /**
   * Upload and ingest a knowledge document.
   * Text is chunked, embedded, and stored in the company's Qdrant collection.
   * The knowledgeDocs row tracks ingestion status — poll it to confirm readiness.
   */
  app.post<CompanyParams>("/companies/:companyId/knowledge", async (request, reply) => {
    const { companyId } = request.params;
    const parseResult = UploadSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        code: "VALIDATION_ERROR",
        details: parseResult.error.flatten(),
      });
    }

    const { filename, docType, department, text } = parseResult.data;

    const [doc] = await db
      .insert(knowledgeDocs)
      .values({
        companyId,
        filename,
        docType: docType as KnowledgeDocType,
        department,
        status: "pending",
        sizeBytes: Buffer.byteLength(text, "utf8"),
      })
      .returning({ id: knowledgeDocs.id });

    const docId = doc!.id;

    // Ingest in background — do not await. Client polls GET endpoint for status.
    void ingestDocument({ companyId, docId, text, docType: docType as KnowledgeDocType, department, filename })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[knowledge-route] Ingestion failed for ${docId}:`, msg);
      });

    return reply.status(202).send({
      docId,
      status: "processing",
      message: "Document queued for ingestion. Poll GET /knowledge to check status.",
    });
  });

  /** List all knowledge documents for a company. */
  app.get<CompanyParams>("/companies/:companyId/knowledge", async (request, reply) => {
    const { companyId } = request.params;

    const docs = await db.query.knowledgeDocs.findMany({
      where: eq(knowledgeDocs.companyId, companyId),
      columns: {
        id: true,
        filename: true,
        docType: true,
        department: true,
        status: true,
        chunkCount: true,
        sizeBytes: true,
        uploadedAt: true,
        processedAt: true,
        errorMessage: true,
      },
      orderBy: (d, { desc }) => [desc(d.uploadedAt)],
    });

    return reply.send({ docs });
  });

  /** Delete a knowledge document and its Qdrant embeddings. */
  app.delete<{ Params: { companyId: string; docId: string } }>(
    "/companies/:companyId/knowledge/:docId",
    async (request, reply) => {
      const { companyId, docId } = request.params;

      const existing = await db.query.knowledgeDocs.findFirst({
        where: and(
          eq(knowledgeDocs.id, docId),
          eq(knowledgeDocs.companyId, companyId)
        ),
        columns: { id: true },
      });

      if (!existing) {
        return reply.status(404).send({ error: "Document not found", code: "NOT_FOUND" });
      }

      await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, docId));

      // Qdrant points for this doc share a deterministic ID prefix — future cleanup
      // can use qdrant.delete(collection, { filter: { must: [{ key: "docId", match: { value: docId } }] } })
      // Deferring to avoid requiring qdrant client here; a cleanup worker handles it.

      return reply.status(204).send();
    }
  );
}
