import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { nanoid } from "nanoid";
import { z } from "zod";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { WhatsAppManager } from "./whatsapp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, "..", "uploads");
const credsDir = path.join(uploadsDir, "creds");
const messagesDir = path.join(uploadsDir, "messages");

const createDirIfNotExists = async (dir: string) => {
  try {
    await fs.access(dir);
  } catch (err) {
    await fs.mkdir(dir, { recursive: true });
  }
};

const storage_config = multer.diskStorage({
  destination: async (req, file, cb) => {
    await createDirIfNotExists(uploadsDir);
    
    if (req.body.type === 'creds') {
      await createDirIfNotExists(credsDir);
      cb(null, credsDir);
    } else {
      await createDirIfNotExists(messagesDir);
      cb(null, messagesDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ storage: storage_config });

// Initialize WhatsApp manager
const whatsAppManager = new WhatsAppManager(storage);

// Definim directorul pentru sesiunile utilizatorilor
const USER_SESSIONS_DIR = path.join(process.cwd(), "user_sessions");

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Ensure upload directories exist
  await createDirIfNotExists(uploadsDir);
  await createDirIfNotExists(credsDir);
  await createDirIfNotExists(messagesDir);
  await createDirIfNotExists(USER_SESSIONS_DIR);
  
  // File upload endpoint
  app.post('/api/whatsapp/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file || !req.body.type) {
        return res.status(400).json({
          success: false,
          message: "Fișier sau tip lipsă"
        });
      }
      
      const { originalname, path: filePath, size } = req.file;
      const fileType = req.body.type as string;
      
      // Save file metadata to storage
      const fileUpload = await storage.saveFileUpload({
        originalName: originalname,
        storagePath: filePath,
        fileType,
        fileSize: size
      });
      
      return res.status(200).json({
        success: true,
        message: "Fișier încărcat cu succes",
        filePath
      });
    } catch (err) {
      console.error("Error uploading file:", err);
      return res.status(500).json({
        success: false,
        message: "Eroare la încărcarea fișierului"
      });
    }
  });
  
  // Start WhatsApp session
  app.post('/api/whatsapp/session/start', async (req: Request, res: Response) => {
    try {
      const sessionSchema = z.object({
        phoneNumber: z.string().min(1),
        phoneId: z.string().optional(),
        targets: z.string().min(1),
        messagePath: z.string().min(1),
        messageText: z.string().optional(),
        delay: z.number().min(1).default(10),
        connectionType: z.enum(['creds', 'phoneId'])
      });
      
      const validationResult = sessionSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          message: "Date de sesiune invalide",
          errors: validationResult.error.format()
        });
      }
      
      const sessionData = validationResult.data;
      
      // Generate a unique session ID
      const sessionId = nanoid();
      
      // Create a new session in storage
      const session = await storage.createSession({
        sessionId,
        phoneNumber: sessionData.phoneNumber,
        connectionType: sessionData.connectionType,
        phoneId: sessionData.phoneId,
        targets: sessionData.targets,
        messagePath: sessionData.messagePath,
        messageText: sessionData.messageText || "",
        delay: sessionData.delay,
        isActive: true
      });
      
      // Start the WhatsApp session
      const success = await whatsAppManager.startSession(session);
      
      if (!success) {
        await storage.updateSessionStatus(sessionId, false);
        return res.status(500).json({
          success: false,
          message: "Nu s-a putut porni sesiunea WhatsApp"
        });
      }
      
      return res.status(200).json({
        success: true,
        message: "Sesiune pornită cu succes",
        sessionId
      });
    } catch (err) {
      console.error("Error starting session:", err);
      return res.status(500).json({
        success: false,
        message: "Eroare la pornirea sesiunii"
      });
    }
  });
  
  // Stop WhatsApp session
  app.post('/api/whatsapp/session/stop', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "ID sesiune lipsă"
        });
      }
      
      // Get session from storage
      const session = await storage.getSessionById(sessionId);
      
      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Sesiune negăsită"
        });
      }
      
      // Stop the WhatsApp session
      const success = await whatsAppManager.stopSession(sessionId);
      
      if (!success) {
        return res.status(500).json({
          success: false,
          message: "Nu s-a putut opri sesiunea"
        });
      }
      
      // Update session status in storage
      await storage.updateSessionStatus(sessionId, false);
      
      return res.status(200).json({
        success: true,
        message: "Sesiune oprită cu succes"
      });
    } catch (err) {
      console.error("Error stopping session:", err);
      return res.status(500).json({
        success: false,
        message: "Eroare la oprirea sesiunii"
      });
    }
  });
  
  // Get session status
  app.get('/api/whatsapp/session/status', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.query;
      
      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({
          success: false,
          message: "ID sesiune lipsă sau invalid"
        });
      }
      
      // Get session from storage
      const session = await storage.getSessionById(sessionId);
      
      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Sesiune negăsită"
        });
      }
      
      return res.status(200).json({
        success: true,
        isActive: session.isActive,
        messageCount: session.messageCount,
        startTime: session.createdAt,
        connectionMethod: session.connectionType
      });
    } catch (err) {
      console.error("Error getting session status:", err);
      return res.status(500).json({
        success: false,
        message: "Eroare la obținerea stării sesiunii"
      });
    }
  });
  
  // Upload Enter creds.json path here endpoint
  const uploadCredsStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const sessionId = req.body.sessionId || nanoid();
      const sessionDir = path.join(USER_SESSIONS_DIR, sessionId);
      
      try {
        await createDirIfNotExists(sessionDir);
        cb(null, sessionDir);
      } catch (err) {
        cb(new Error(`Eroare la crearea directorului pentru sesiune: ${err}`), '');
      }
    },
    filename: (req, file, cb) => {
      // Salvăm întotdeauna ca Enter creds.json path here
      cb(null, 'Enter creds.json path here');
    }
  });
  
  const uploadCreds = multer({ storage: uploadCredsStorage });
  
  // Endpoint pentru încărcarea fișierului Enter creds.json path here
  app.post('/api/whatsapp/creds/upload', uploadCreds.single('creds'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Fișierul Enter creds.json path here lipsește"
        });
      }
      
      // Generăm sau folosim sessionId
      const sessionId = req.body.sessionId || nanoid();
      const sessionDir = path.join(USER_SESSIONS_DIR, sessionId);
      const credsPath = path.join(sessionDir, 'Enter creds.json path here');
      
      // Verificăm dacă fișierul este un JSON valid
      try {
        const fileContent = await fs.readFile(credsPath, 'utf-8');
        JSON.parse(fileContent); // Verificăm dacă e JSON valid
      } catch (err) {
        await fs.unlink(credsPath).catch(e => console.error("Eroare la ștergerea fișierului invalid:", e));
        return res.status(400).json({
          success: false,
          message: "Fișierul Enter creds.json path here este invalid sau corupt"
        });
      }
      
      return res.status(200).json({
        success: true,
        message: "Fișierul Enter creds.json path here a fost încărcat cu succes",
        sessionId
      });
    } catch (err) {
      console.error("Error uploading Enter creds.json path here:", err);
      return res.status(500).json({
        success: false,
        message: "Eroare la încărcarea fișierului Enter creds.json path here"
      });
    }
  });

  return httpServer;
}
