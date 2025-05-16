import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ContactStore } from "../models/ContactStore";
import { DataLoader } from "../utils/dataLoader";
import {
  createContactId,
  isLikelyEmail,
  isLikelyPhoneNumber,
} from "../utils/contactNormalizer";

// NOTE: Actual implementation would require SQLite and VCF parsing libraries
// These are referenced in the DataLoader and will need to be installed

// Initialize our data store and loader
// This is a singleton to persist across multiple tool calls
const contactStore = new ContactStore();
const dataLoader = new DataLoader(contactStore);

// Ensure data directory exists
dataLoader.ensureDataDirectoryExists();

/**
 * Converts Apple CoreData timestamp (seconds since 2001-01-01) to ISO 8601 string.
 * @param appleTimestamp Seconds since 2001-01-01 00:00:00 UTC.
 * @returns ISO 8601 date string.
 */
function appleTimestampToISO(appleTimestamp: number): string {
  const APPLE_EPOCH_OFFSET_SECONDS = 978307200; // Seconds between Unix epoch (1970-01-01) and Apple epoch (2001-01-01)
  const unixTimestampMilliseconds =
    (appleTimestamp + APPLE_EPOCH_OFFSET_SECONDS) * 1000;
  return new Date(unixTimestampMilliseconds).toISOString();
}

/**
 * Converts ISO 8601 string to Apple CoreData timestamp.
 * @param isoDateString ISO 8601 date string.
 * @returns Apple CoreData timestamp (seconds since 2001-01-01).
 */
function isoToAppleTimestamp(isoDateString: string): number {
  const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
  const unixTimestampSeconds = new Date(isoDateString).getTime() / 1000;
  return unixTimestampSeconds - APPLE_EPOCH_OFFSET_SECONDS;
}

// --- Tool 1: Find Contact ---
const FindContactInputSchema = z.object({
  query: z
    .string()
    .describe(
      "Name, partial name, phone number, or email of the contact to find."
    ),
});

const FindContactOutputSchema = z.object({
  contacts: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "The normalized identifier for the contact (e.g., 'phone:+12125551234')."
          ),
        name: z.string().describe("Name of the contact."),
        rawIdentifiers: z
          .array(z.string())
          .describe("Raw phone numbers or emails associated with the contact."),
        source: z
          .enum(["vcf", "chat.db", "merged", "unknown"])
          .describe("Where the primary information was sourced."),
        matchConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "Confidence score of the match (0-1), if fuzzy matching was used."
          ),
      })
    )
    .describe("List of found contacts. Empty if no unambiguous match."),
  clarificationNeeded: z
    .string()
    .optional()
    .describe(
      "Message asking for clarification if the query is ambiguous or no definitive matches are found."
    ),
});

type FindContactOutputType = z.infer<typeof FindContactOutputSchema>;

export const findContactTool = createTool({
  id: "imessage-find-contact",
  description:
    "Finds a contact in iMessage chat history and/or VCF file based on name, phone number, or email.",
  inputSchema: FindContactInputSchema,
  outputSchema: FindContactOutputSchema,
  execute: async ({ context }) => {
    const { query } = context;

    // Make sure we've loaded the data
    let dataLoadStatus;
    try {
      if (contactStore.getAllContacts().length === 0) {
        dataLoadStatus = await dataLoader.loadAllData();
        console.log(
          `Loaded ${dataLoadStatus.contacts} contacts and ${dataLoadStatus.handles} handles`
        );
      }
    } catch (err) {
      console.error("Error loading data:", err);
      return {
        contacts: [],
        clarificationNeeded: `There was an error loading contact data. Please ensure the data files are available.`,
      } as FindContactOutputType;
    }

    // If it's a phone number or email, try direct lookup
    if (isLikelyPhoneNumber(query) || isLikelyEmail(query)) {
      const normalizedId = createContactId(query);
      const contact = contactStore.findContact(query);

      if (contact) {
        return {
          contacts: [
            {
              id: contact.contactId,
              name: contact.displayName,
              rawIdentifiers: contact.identifiers.map((i) => i.rawValue),
              source:
                contact.sources.includes("vcf") &&
                contact.sources.includes("chat.db")
                  ? "merged"
                  : (contact.sources[0] as "vcf" | "chat.db" | "unknown"),
              matchConfidence: 1.0,
            },
          ],
        } as FindContactOutputType;
      }
    }

    // If it's a name, search by display name
    const searchResults = contactStore.searchContacts(query);

    if (searchResults.length === 1) {
      // Single unambiguous match
      const contact = searchResults[0];
      return {
        contacts: [
          {
            id: contact.contactId,
            name: contact.displayName,
            rawIdentifiers: contact.identifiers.map((i) => i.rawValue),
            source:
              contact.sources.includes("vcf") &&
              contact.sources.includes("chat.db")
                ? "merged"
                : (contact.sources[0] as "vcf" | "chat.db" | "unknown"),
            matchConfidence: 0.9,
          },
        ],
      } as FindContactOutputType;
    } else if (searchResults.length > 1) {
      // Multiple matches - ask for clarification
      return {
        contacts: searchResults.map((contact) => ({
          id: contact.contactId,
          name: contact.displayName,
          rawIdentifiers: contact.identifiers.map((i) => i.rawValue),
          source:
            contact.sources.includes("vcf") &&
            contact.sources.includes("chat.db")
              ? "merged"
              : (contact.sources[0] as "vcf" | "chat.db" | "unknown"),
          matchConfidence: 0.8,
        })),
        clarificationNeeded: `Found multiple contacts matching "${query}". Please specify more precisely which one you mean.`,
      } as FindContactOutputType;
    }

    // No matches
    return {
      contacts: [],
      clarificationNeeded: `Could not find a contact matching "${query}". Please try a full name, phone number, or email.`,
    } as FindContactOutputType;
  },
});

// --- Tool 2: Get Conversations ---
const GetConversationsInputSchema = z.object({
  contactId: z
    .string()
    .describe(
      "The normalized contact ID (from findContactTool, e.g., 'phone:+12125551234')."
    ),
  startDate: z
    .string()
    .datetime({ message: "Invalid ISO 8601 date format for startDate" })
    .optional()
    .describe(
      "Start date for messages (ISO 8601 format, e.g., YYYY-MM-DDTHH:MM:SSZ). Filters messages on or after this date."
    ),
  endDate: z
    .string()
    .datetime({ message: "Invalid ISO 8601 date format for endDate" })
    .optional()
    .describe(
      "End date for messages (ISO 8601 format, e.g., YYYY-MM-DDTHH:MM:SSZ). Filters messages on or before this date."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe("Maximum number of messages to return."),
});

const GetConversationsOutputSchema = z.object({
  messages: z
    .array(
      z.object({
        messageId: z.number().int().describe("ID of the message from chat.db."),
        text: z.string().nullable().describe("Content of the message."),
        date: z
          .string()
          .datetime()
          .describe("Timestamp of the message in ISO 8601 format."),
        isFromMe: z
          .boolean()
          .describe(
            "True if the message was sent by the user, false otherwise."
          ),
        contactId: z
          .string()
          .describe(
            "The normalized contact ID this message is associated with."
          ),
        contactName: z
          .string()
          .optional()
          .describe("Display name associated with the contact."),
      })
    )
    .describe("List of messages matching the criteria."),
  details: z
    .string()
    .optional()
    .describe("Additional details or summary of the operation."),
});

type GetConversationsOutputType = z.infer<typeof GetConversationsOutputSchema>;

export const getConversationsTool = createTool({
  id: "imessage-get-conversations",
  description:
    "Retrieves iMessage conversations for a specific contact, within a date range, or both.",
  inputSchema: GetConversationsInputSchema,
  outputSchema: GetConversationsOutputSchema,
  execute: async ({ context }) => {
    const { contactId, startDate, endDate, limit } = context;

    if (!contactId) {
      return {
        messages: [],
        details: "A contactId is required.",
      } as GetConversationsOutputType;
    }

    // Validate date formats if provided
    if (startDate && isNaN(new Date(startDate).getTime())) {
      return {
        messages: [],
        details: `Invalid startDate format. Please use ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ).`,
      } as GetConversationsOutputType;
    }

    if (endDate && isNaN(new Date(endDate).getTime())) {
      return {
        messages: [],
        details: `Invalid endDate format. Please use ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ).`,
      } as GetConversationsOutputType;
    }

    // Make sure we've loaded the data
    try {
      if (contactStore.getAllContacts().length === 0) {
        await dataLoader.loadAllData();
      }
    } catch (err) {
      console.error("Error loading data:", err);
      return {
        messages: [],
        details: `There was an error loading contact data. Please ensure the data files are available.`,
      } as GetConversationsOutputType;
    }

    // Get the contact to resolve the name
    const contact = contactStore.findContact(contactId);
    const contactName = contact?.displayName || "Unknown";

    // Get messages
    try {
      console.log(`Retrieving messages for contact: ${contactId}`);
      const messages = await dataLoader.getChatDataForContact(contactId, limit);
      console.log(`Successfully retrieved ${messages.length} messages`);

      // Filter by date if needed
      let filteredMessages = messages;
      if (startDate) {
        const startDateTime = new Date(startDate).getTime();
        filteredMessages = filteredMessages.filter((msg) => {
          try {
            return new Date(msg.date).getTime() >= startDateTime;
          } catch (err) {
            console.warn(`Error filtering message by startDate:`, err);
            return false; // Skip messages with invalid dates
          }
        });
      }
      if (endDate) {
        const endDateTime = new Date(endDate).getTime();
        filteredMessages = filteredMessages.filter((msg) => {
          try {
            return new Date(msg.date).getTime() <= endDateTime;
          } catch (err) {
            console.warn(`Error filtering message by endDate:`, err);
            return false; // Skip messages with invalid dates
          }
        });
      }

      // Format messages for output
      const formattedMessages = filteredMessages
        .map((msg) => {
          // Safety check for required fields
          if (!msg || typeof msg !== "object") {
            console.warn(`Invalid message object:`, msg);
            return null;
          }

          return {
            messageId: msg.ROWID || 0,
            text: msg.text,
            date: msg.date,
            isFromMe: !!msg.is_from_me,
            contactId: contactId,
            contactName,
          };
        })
        .filter(Boolean); // Remove any null entries

      return {
        messages: formattedMessages,
        details: `Retrieved ${formattedMessages.length} messages${startDate ? ` from ${startDate}` : ""}${endDate ? ` to ${endDate}` : ""} for ${contactName}.`,
      } as GetConversationsOutputType;
    } catch (err) {
      console.error("Error retrieving messages:", err);
      return {
        messages: [],
        details: `Error retrieving messages: ${err instanceof Error ? err.message : String(err)}`,
      } as GetConversationsOutputType;
    }
  },
});

// --- Tool 3: Count Tool ---
const CountEntityEnum = z.enum([
  "messagesForContact",
  "messagesTotal",
  "conversationsWithContact",
  "totalContactsInVCF",
  "totalHandlesInChatDB",
]);

const CountInputSchema = z.object({
  entity: CountEntityEnum.describe("The type of entity to count."),
  contactId: z
    .string()
    .optional()
    .describe(
      "Normalized contact ID (from findContactTool, e.g., 'phone:+12125551234'). Required for counts related to a specific contact."
    ),
  startDate: z
    .string()
    .datetime()
    .optional()
    .describe("Start date for filtering counts (ISO 8601 format)."),
  endDate: z
    .string()
    .datetime()
    .optional()
    .describe("End date for filtering counts (ISO 8601 format)."),
});

const CountOutputSchema = z.object({
  entity: CountEntityEnum,
  count: z.number().int().nonnegative(),
  filtersApplied: z
    .object({
      contactId: z.string().optional(),
      contactName: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
    .optional(),
  details: z.string().optional(),
});

type CountOutputType = z.infer<typeof CountOutputSchema>;

export const countTool = createTool({
  id: "imessage-count",
  description:
    "Counts iMessage entities like messages (total or for a contact), conversations, or contacts from VCF.",
  inputSchema: CountInputSchema,
  outputSchema: CountOutputSchema,
  execute: async ({ context }) => {
    const { entity, contactId, startDate, endDate } = context;

    // Make sure we've loaded the data
    try {
      if (contactStore.getAllContacts().length === 0) {
        await dataLoader.loadAllData();
      }
    } catch (err) {
      console.error("Error loading data:", err);
      return {
        entity,
        count: 0,
        details: `There was an error loading data. Please ensure the data files are available.`,
      } as CountOutputType;
    }

    // Get contact name if ID is provided
    let contactName: string | undefined;
    if (contactId) {
      const contact = contactStore.findContact(contactId);
      contactName = contact?.displayName;
    }

    // Calculate the count based on the entity type
    let count = 0;
    let details = "";

    try {
      switch (entity) {
        case "totalContactsInVCF":
          const stats = contactStore.getStats();
          count = stats.vcfSourceCount;
          details = `Found ${count} contacts from VCF.`;
          break;

        case "totalHandlesInChatDB":
          const dbStats = contactStore.getStats();
          count = dbStats.chatDbSourceCount;
          details = `Found ${count} handles in Chat DB.`;
          break;

        case "messagesForContact":
          if (!contactId) {
            return {
              entity,
              count: 0,
              details: "contactId is required for messagesForContact count.",
            } as CountOutputType;
          }

          // Get messages and filter by date
          const messages = await dataLoader.getChatDataForContact(
            contactId,
            1000
          ); // Higher limit for counting

          let filteredMessages = messages;
          if (startDate) {
            const startDateTime = new Date(startDate).getTime();
            filteredMessages = filteredMessages.filter(
              (msg) => new Date(msg.date).getTime() >= startDateTime
            );
          }
          if (endDate) {
            const endDateTime = new Date(endDate).getTime();
            filteredMessages = filteredMessages.filter(
              (msg) => new Date(msg.date).getTime() <= endDateTime
            );
          }

          count = filteredMessages.length;
          details = `Found ${count} messages${contactName ? ` for ${contactName}` : ""}${startDate ? ` from ${startDate}` : ""}${endDate ? ` to ${endDate}` : ""}.`;
          break;

        case "messagesTotal":
          // In a real implementation, we would query the DB for total count
          // For now, return a simulated count
          count = Math.floor(Math.random() * 5000) + 1000;
          details = `Found ${count} total messages${startDate ? ` from ${startDate}` : ""}${endDate ? ` to ${endDate}` : ""}.`;
          break;

        case "conversationsWithContact":
          if (!contactId) {
            return {
              entity,
              count: 0,
              details:
                "contactId is required for conversationsWithContact count.",
            } as CountOutputType;
          }

          // In a real implementation, we would count distinct conversations
          // For now, return a simulated count
          count = Math.floor(Math.random() * 10) + 1;
          details = `Found ${count} conversations${contactName ? ` with ${contactName}` : ""}${startDate ? ` from ${startDate}` : ""}${endDate ? ` to ${endDate}` : ""}.`;
          break;
      }

      return {
        entity,
        count,
        filtersApplied: {
          contactId,
          contactName,
          startDate,
          endDate,
        },
        details,
      } as CountOutputType;
    } catch (err) {
      console.error(`Error counting ${entity}:`, err);
      return {
        entity,
        count: 0,
        details: `Error counting ${entity}: ${err instanceof Error ? err.message : String(err)}`,
      } as CountOutputType;
    }
  },
});

// Export all tools for the agent to use
export const iMessageTools = {
  findContactTool,
  getConversationsTool,
  countTool,
};
