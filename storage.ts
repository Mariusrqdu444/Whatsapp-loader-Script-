import { 
  User, 
  InsertUser, 
  WhatsappSession, 
  InsertWhatsappSession,
  FileUpload,
  InsertFileUpload
} from "@shared/schema";
import { nanoid } from "nanoid";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // WhatsApp session methods
  createSession(session: InsertWhatsappSession): Promise<WhatsappSession>;
  getSessionById(sessionId: string): Promise<WhatsappSession | undefined>;
  updateSessionStatus(sessionId: string, isActive: boolean): Promise<WhatsappSession | undefined>;
  incrementMessageCount(sessionId: string): Promise<number>;
  
  // File upload methods
  saveFileUpload(fileUpload: InsertFileUpload): Promise<FileUpload>;
  getFileUploadByPath(path: string): Promise<FileUpload | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private sessions: Map<string, WhatsappSession>;
  private fileUploads: Map<number, FileUpload>;
  private userCurrentId: number;
  private fileUploadCurrentId: number;

  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.fileUploads = new Map();
    this.userCurrentId = 1;
    this.fileUploadCurrentId = 1;
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  
  // WhatsApp session methods
  async createSession(sessionData: InsertWhatsappSession): Promise<WhatsappSession> {
    const now = new Date();
    const session: WhatsappSession = {
      id: this.sessions.size + 1,
      sessionId: sessionData.sessionId,
      phoneNumber: sessionData.phoneNumber,
      connectionType: sessionData.connectionType,
      phoneId: sessionData.phoneId || null,
      targets: sessionData.targets,
      messagePath: sessionData.messagePath,
      messageText: sessionData.messageText,
      delay: sessionData.delay || 5, // Valoare implicită de 5 secunde
      messageCount: 0,
      isActive: false, // Inițial sesiunea nu este activă
      createdAt: now,
      updatedAt: now
    };
    
    this.sessions.set(session.sessionId, session);
    return session;
  }
  
  async getSessionById(sessionId: string): Promise<WhatsappSession | undefined> {
    return this.sessions.get(sessionId);
  }
  
  async updateSessionStatus(sessionId: string, isActive: boolean): Promise<WhatsappSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    const updatedSession = {
      ...session,
      isActive,
      updatedAt: new Date()
    };
    
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }
  
  async incrementMessageCount(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    
    const newCount = session.messageCount + 1;
    const updatedSession = {
      ...session,
      messageCount: newCount,
      updatedAt: new Date()
    };
    
    this.sessions.set(sessionId, updatedSession);
    return newCount;
  }
  
  // File upload methods
  async saveFileUpload(fileUpload: InsertFileUpload): Promise<FileUpload> {
    const id = this.fileUploadCurrentId++;
    const now = new Date();
    
    const upload: FileUpload = {
      ...fileUpload,
      id,
      createdAt: now
    };
    
    this.fileUploads.set(id, upload);
    return upload;
  }
  
  async getFileUploadByPath(path: string): Promise<FileUpload | undefined> {
    return Array.from(this.fileUploads.values()).find(
      (upload) => upload.storagePath === path
    );
  }
}

export const storage = new MemStorage();
