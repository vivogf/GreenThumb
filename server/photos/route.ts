import { pipeline } from "node:stream/promises";
import type { Request, RequestHandler, Response } from "express";
import { contentTypeForFile, keyForFileName } from "./keys";
import { PHOTO_CACHE_CONTROL, type PhotoObject, type PhotoStore } from "./store";
import { logError } from "../logError";

function notFound(res: Response) {
  res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Not found");
}

/**
 * GET /photos/:file — public by unguessable URL, so it must be mounted before
 * the session middleware (no Set-Cookie, nginx can cache it).
 */
export function createPhotoHandler(getStore: () => PhotoStore | null): RequestHandler {
  return async (req: Request, res: Response) => {
    const file = req.params.file ?? "";
    const key = keyForFileName(file);
    if (!key) return notFound(res);
    const store = getStore();
    if (!store) {
      res.status(503).set("Cache-Control", "no-store").type("text/plain").send("Photo storage unavailable");
      return;
    }
    let object: PhotoObject | null = null;
    try {
      object = await store.getStream(key);
      if (!object) return notFound(res);
      res.status(200).set({
        "Content-Type": contentTypeForFile(file),
        "Cache-Control": PHOTO_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      });
      if (object.contentLength !== undefined) res.set("Content-Length", String(object.contentLength));
      if (object.etag) res.set("ETag", object.etag);
      await pipeline(object.body, res);
    } catch (err: any) {
      object?.body.destroy();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // The key is the unguessable public URL of the photo, so it is not logged.
      logError("Photo read failed", err);
      res.status(502).set("Cache-Control", "no-store").type("text/plain").send("Photo unavailable");
    }
  };
}

/** Any other /photos path must be a 404, never the SPA index.html. */
export const photoPathNotFound: RequestHandler = (_req, res) => notFound(res);
