import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      session?: {
        user_id: string;
      };
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware to extract user_id from header
  app.use((req: Request, res, next) => {
    const userId = req.headers["x-user-id"] as string;
    if (userId) {
      req.session = { user_id: userId };
    }
    next();
  });

  // Plant routes
  app.post("/api/plants", async (req: Request, res) => {
    try {
      const user_id = req.session?.user_id;
      if (!user_id) {
        return res.status(400).json({ error: "User ID required" });
      }

      const plant = insertPlantSchema.parse(req.body);
      const result = await storage.addPlant({ ...plant, user_id });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/plants", async (req: Request, res) => {
    try {
      const user_id = req.session?.user_id;
      if (!user_id) {
        return res.json([]);
      }

      const userPlants = await storage.getPlantsByUserId(user_id);
      res.json(userPlants);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/plants/:id", async (req: Request, res) => {
    try {
      const user_id = req.session?.user_id;
      if (!user_id) {
        return res.status(400).json({ error: "User ID required" });
      }

      const plant = await storage.updatePlant(req.params.id, req.body);
      res.json(plant);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/plants/:id", async (req: Request, res) => {
    try {
      const user_id = req.session?.user_id;
      if (!user_id) {
        return res.status(400).json({ error: "User ID required" });
      }

      await storage.deletePlant(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
