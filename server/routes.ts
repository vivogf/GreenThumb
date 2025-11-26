import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPlantSchema, registerSchema, loginSchema } from "@shared/schema";

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

  // Auth routes
  app.post("/api/auth/register", async (req: Request, res) => {
    try {
      const data = registerSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }
      
      const user = await storage.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        name: data.name || null,
      });
      
      // Return user without password
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
      
      // Return user without password
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get all users (for admin view)
  app.get("/api/users", async (req: Request, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      // Return users without passwords
      const safeUsers = allUsers.map(({ password: _, ...user }) => user);
      res.json(safeUsers);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Plant routes
  app.post("/api/plants", async (req: Request, res) => {
    try {
      const user_id = req.session?.user_id;
      if (!user_id) {
        return res.status(400).json({ error: "User ID required" });
      }

      const plantData = insertPlantSchema.parse(req.body);
      const plantWithUser = { ...plantData, user_id };
      const result = await storage.addPlant(plantWithUser);
      res.json(result);
    } catch (error: any) {
      console.error("Error adding plant:", error);
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
