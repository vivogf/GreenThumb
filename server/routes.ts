import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema, registerSchema, loginSchema } from "@shared/schema";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes
  app.post("/api/auth/register", async (req: Request, res) => {
    try {
      const data = registerSchema.parse(req.body);
      
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }
      
      const user = await storage.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        name: data.name || null,
      });
      
      req.session.userId = user.id;
      
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.validatePassword(data.email, data.password);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      
      req.session.userId = user.id;
      
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", (req: Request, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  // Plant routes (protected)
  app.post("/api/plants", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const plantData = insertPlantSchema.parse(req.body);
      const plantWithUser = { ...plantData, user_id: String(userId) };
      const result = await storage.addPlant(plantWithUser);
      res.json(result);
    } catch (error: any) {
      console.error("Error adding plant:", error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/plants", requireAuth, async (req: Request, res) => {
    try {
      const userId = req.session.userId!;
      const userPlants = await storage.getPlantsByUserId(String(userId));
      res.json(userPlants);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      const plant = await storage.updatePlant(req.params.id, req.body);
      res.json(plant);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/plants/:id", requireAuth, async (req: Request, res) => {
    try {
      await storage.deletePlant(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
