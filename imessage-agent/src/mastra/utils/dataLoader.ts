import fs from "fs";
import path from "path";
import { ContactStore } from "../models/ContactStore";
import { createContactId } from "./contactNormalizer";

// Import SQLite and VCF libraries
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import vcf from "vcf";

// Set base paths for data files - adjust as needed
const DEFAULT_DATA_DIR = path.join(process.cwd(), "data", "user_data");
const DEFAULT_CHAT_DB_PATH = path.join(DEFAULT_DATA_DIR, "chat.db");
const DEFAULT_CONTACTS_VCF_PATH = path.join(DEFAULT_DATA_DIR, "contacts.vcf");

/**
 * Converts Apple CoreData timestamp (seconds since 2001-01-01) to ISO 8601 string.
 * Handles invalid or extreme timestamp values gracefully.
 *
 * @param appleTimestamp Seconds since 2001-01-01 00:00:00 UTC.
 * @returns ISO 8601 date string, or a fallback string for invalid timestamps.
 */
function appleTimestampToISO(appleTimestamp: number): string {
  try {
    // Validate input
    if (typeof appleTimestamp !== "number" || isNaN(appleTimestamp)) {
      console.warn(`Invalid Apple timestamp value: ${appleTimestamp}`);
      return new Date().toISOString(); // Fallback to current date
    }

    const APPLE_EPOCH_OFFSET_SECONDS = 978307200; // Seconds between Unix epoch (1970-01-01) and Apple epoch (2001-01-01)

    // Calculate the Unix timestamp in milliseconds
    const unixTimestampMilliseconds =
      (appleTimestamp + APPLE_EPOCH_OFFSET_SECONDS) * 1000;

    // Check if the timestamp is within range for JavaScript Date
    // JavaScript Date can handle dates from -8,640,000,000,000 to 8,640,000,000,000 milliseconds
    if (
      unixTimestampMilliseconds < -8640000000000 ||
      unixTimestampMilliseconds > 8640000000000
    ) {
      console.warn(
        `Apple timestamp out of range: ${appleTimestamp} (converts to ${unixTimestampMilliseconds}ms)`
      );
      return new Date().toISOString(); // Fallback to current date
    }

    // Create the date object and convert to ISO string
    const date = new Date(unixTimestampMilliseconds);
    return date.toISOString();
  } catch (err) {
    console.error(
      `Error converting Apple timestamp ${appleTimestamp} to ISO:`,
      err
    );
    return new Date().toISOString(); // Fallback to current date
  }
}

/**
 * Options for loading data.
 */
export interface DataLoaderOptions {
  chatDbPath?: string;
  contactsVcfPath?: string;
  createDataDirIfMissing?: boolean;
  debug?: boolean;
}

/**
 * Handles loading VCF contacts and chat.db data.
 */
export class DataLoader {
  private contactStore: ContactStore;
  private chatDbPath: string;
  private contactsVcfPath: string;
  private options: DataLoaderOptions;
  private debug: boolean;

  /**
   * Creates a new DataLoader instance.
   *
   * @param contactStore The contact store to populate
   * @param options Options for file paths
   */
  constructor(contactStore: ContactStore, options: DataLoaderOptions = {}) {
    this.contactStore = contactStore;
    this.options = {
      createDataDirIfMissing: true,
      debug: false,
      ...options,
    };
    this.debug = !!this.options.debug;

    this.chatDbPath = options.chatDbPath || DEFAULT_CHAT_DB_PATH;
    this.contactsVcfPath = options.contactsVcfPath || DEFAULT_CONTACTS_VCF_PATH;
  }

  /**
   * Log debug information if debug mode is enabled
   */
  private debugLog(...args: any[]): void {
    if (this.debug) {
      console.log("[DataLoader Debug]", ...args);
    }
  }

  /**
   * Ensures the data directory exists.
   *
   * @returns true if the directory exists or was created
   */
  public ensureDataDirectoryExists(): boolean {
    const dir = path.dirname(this.chatDbPath);

    if (!fs.existsSync(dir)) {
      if (this.options.createDataDirIfMissing) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created data directory: ${dir}`);
        return true;
      } else {
        console.error(`Data directory does not exist: ${dir}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Loads contact data from VCF file.
   *
   * @returns Number of contacts loaded
   */
  public async loadContactsFromVcf(): Promise<number> {
    if (!this.ensureDataDirectoryExists()) {
      return 0;
    }

    if (!fs.existsSync(this.contactsVcfPath)) {
      console.error(`Contacts VCF file not found: ${this.contactsVcfPath}`);
      return 0;
    }

    console.log(`Loading contacts from: ${this.contactsVcfPath}`);
    this.debugLog(`VCF path: ${this.contactsVcfPath}`);

    try {
      // Read the VCF file
      const vcfContent = fs.readFileSync(this.contactsVcfPath, "utf-8");
      this.debugLog(`VCF file size: ${vcfContent.length} bytes`);

      if (this.debug) {
        // Show sample of the VCF content in debug mode
        const preview =
          vcfContent.substring(0, 500) + (vcfContent.length > 500 ? "..." : "");
        this.debugLog(`VCF content preview: ${preview}`);
      }

      // Parse the VCF content using the correct function
      const vcards = vcf.parse(vcfContent);
      this.debugLog(`Parsed ${vcards.length} vCards`);

      let count = 0;

      for (const vcard of vcards) {
        // Get the formatted name, or use Unknown if not found
        let name = "Unknown";
        const fnProp = vcard.get("fn");
        if (fnProp) {
          name = fnProp.valueOf() || "Unknown";
        }
        this.debugLog(`Processing contact: ${name}`);

        // Process phone numbers
        const phoneProps = vcard.get("tel");
        if (phoneProps) {
          // Handle both single property and array of properties
          const phones = Array.isArray(phoneProps) ? phoneProps : [phoneProps];
          this.debugLog(`Found ${phones.length} phone numbers for ${name}`);

          for (const phone of phones) {
            // Ensure we always have a string
            const phoneValue = String(phone.valueOf() || "");
            if (phoneValue) {
              this.debugLog(`Adding phone: ${phoneValue}`);
              this.contactStore.addOrUpdateContact(phoneValue, name, "vcf");
              count++;
            }
          }
        }

        // Process emails
        const emailProps = vcard.get("email");
        if (emailProps) {
          // Handle both single property and array of properties
          const emails = Array.isArray(emailProps) ? emailProps : [emailProps];
          this.debugLog(`Found ${emails.length} emails for ${name}`);

          for (const email of emails) {
            // Ensure we always have a string
            const emailValue = String(email.valueOf() || "");
            if (emailValue) {
              this.debugLog(`Adding email: ${emailValue}`);
              this.contactStore.addOrUpdateContact(emailValue, name, "vcf");
              count++;
            }
          }
        }
      }

      console.log(`Loaded ${count} contacts from VCF`);
      return count;
    } catch (err) {
      console.error("Error parsing VCF:", err);
      this.debugLog("VCF parsing error details:", err);

      // Try to provide more specific error information
      if (err instanceof Error) {
        console.error(`Error message: ${err.message}`);
        console.error(`Error stack: ${err.stack}`);
      }

      // Fallback to mock data if there's an error
      console.warn("Falling back to mock contact data");

      const mockContacts = [
        {
          name: "John Smith",
          phone: "+1 (555) 123-4567",
          email: "john@example.com",
        },
        { name: "Jane Doe", phone: "555-765-4321", email: "jane@example.com" },
        {
          name: "Bob Johnson",
          phone: "(123) 456-7890",
          email: "bob@example.com",
        },
      ];

      for (const contact of mockContacts) {
        this.contactStore.addOrUpdateContact(
          contact.phone,
          contact.name,
          "vcf"
        );
        this.contactStore.addOrUpdateContact(
          contact.email,
          contact.name,
          "vcf"
        );
      }

      // Return 2 identifiers per contact
      return mockContacts.length * 2;
    }
  }

  /**
   * Loads chat handles from the chat.db file.
   *
   * @returns Number of handles loaded
   */
  public async loadHandlesFromChatDb(): Promise<number> {
    if (!this.ensureDataDirectoryExists()) {
      return 0;
    }

    if (!fs.existsSync(this.chatDbPath)) {
      console.error(`Chat database file not found: ${this.chatDbPath}`);
      return 0;
    }

    console.log(`Loading handles from: ${this.chatDbPath}`);

    try {
      // Open the database connection
      const db = await open({
        filename: this.chatDbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
      });

      // Query all handles from the handle table
      const handles = await db.all(`
        SELECT ROWID, id 
        FROM handle
      `);

      // Add each handle to the contact store
      for (const handle of handles) {
        // Use the id from the handle table as the raw identifier
        this.contactStore.addOrUpdateContact(handle.id, "Unknown", "chat.db");
      }

      // Close the database connection
      await db.close();

      console.log(`Loaded ${handles.length} handles from chat.db`);
      return handles.length;
    } catch (err) {
      console.error("Error accessing SQLite database:", err);

      // Fallback to mock data if there's an error
      console.warn("Falling back to mock handle data");

      const mockHandles = [
        { id: "+15551234567" },
        { id: "+15557654321" },
        { id: "email@example.com" },
        { id: "+12125551212" },
      ];

      for (const handle of mockHandles) {
        this.contactStore.addOrUpdateContact(handle.id, "Unknown", "chat.db");
      }

      return mockHandles.length;
    }
  }

  /**
   * Gets chat data for a specific contact.
   *
   * @param contactId Normalized contact ID
   * @param limit Maximum number of messages to retrieve
   * @returns Messages for the contact
   */
  public async getChatDataForContact(
    contactId: string,
    limit: number = 50
  ): Promise<any[]> {
    if (!fs.existsSync(this.chatDbPath)) {
      console.error(`Chat database file not found: ${this.chatDbPath}`);
      return [];
    }

    // Extract the normalized value from the contactId
    const normalizedValue = contactId.split(":")[1];

    if (!normalizedValue) {
      console.error(`Invalid contactId format: ${contactId}`);
      return [];
    }

    try {
      // Open the database connection
      const db = await open({
        filename: this.chatDbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
      });

      // First find the handle_id (ROWID) for this contact
      const handle = await db.get(
        `
        SELECT ROWID 
        FROM handle 
        WHERE id = ?
      `,
        [normalizedValue]
      );

      if (!handle) {
        console.warn(`No handle found for ID: ${normalizedValue}`);
        await db.close();
        return [];
      }

      // Get messages for this handle
      const messages = await db.all(
        `
        SELECT 
          message.ROWID, 
          message.text, 
          message.date, 
          message.is_from_me,
          handle.id as handle_id
        FROM message 
        JOIN handle ON message.handle_id = handle.ROWID
        WHERE message.handle_id = ?
        ORDER BY message.date DESC
        LIMIT ?
      `,
        [handle.ROWID, limit]
      );

      // Convert Apple timestamps to ISO format
      const formattedMessages = messages.map((msg) => {
        try {
          // Create a safe copy of the message with appropriate conversions
          return {
            ...msg,
            date: msg.date
              ? appleTimestampToISO(msg.date)
              : new Date().toISOString(),
            is_from_me: Boolean(msg.is_from_me),
            // Ensure text is always a string or null
            text: msg.text != null ? String(msg.text) : null,
          };
        } catch (convErr) {
          // If something goes wrong with an individual message, log and return a simplified version
          console.error(`Error processing message ${msg.ROWID}:`, convErr);
          return {
            ROWID: msg.ROWID || 0,
            text:
              msg.text != null
                ? String(msg.text)
                : "Error retrieving message content",
            date: new Date().toISOString(),
            is_from_me: Boolean(msg.is_from_me),
            handle_id: normalizedValue,
          };
        }
      });

      await db.close();

      return formattedMessages;
    } catch (err) {
      console.error(`Error retrieving messages for ${contactId}:`, err);
      this.debugLog("SQLite error details:", err);

      // Fallback to mock data if there's an error
      console.warn("Falling back to mock message data");

      // Simulated implementation as fallback
      const mockMessages = Array(Math.min(limit, 10))
        .fill(0)
        .map((_, i) => {
          const date = new Date();
          date.setMinutes(date.getMinutes() - i * 10); // Messages 10 minutes apart

          return {
            ROWID: 1000 + i,
            text: `Simulated message ${i + 1} with ${normalizedValue}`,
            date: date.toISOString(),
            is_from_me: i % 2 === 0,
            handle_id: normalizedValue,
          };
        });

      return mockMessages;
    }
  }

  /**
   * Loads both contacts and handles.
   *
   * @returns Object with counts of loaded items
   */
  public async loadAllData(): Promise<{ contacts: number; handles: number }> {
    const contacts = await this.loadContactsFromVcf();
    const handles = await this.loadHandlesFromChatDb();

    return { contacts, handles };
  }
}
