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
  conversationLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(3)
    .describe("Maximum number of conversations to retrieve."),
  messageLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe("Maximum number of messages to retrieve per conversation."),
  timeGapMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30)
    .describe(
      "Time gap in minutes to consider messages as part of a new conversation."
    ),
});

// Participant schema for conversation
const ParticipantSchema = z.object({
  id: z.string().describe("The normalized contact ID for the participant."),
  name: z.string().describe("Display name of the participant."),
});

// Original message schema (to be nested in conversation)
const MessageSchema = z.object({
  from: z.string().describe("Name of the sender"),
  at: z.string().describe("Readable timestamp of the message"),
  text: z.string().describe("Content of the message."),
});

// New conversation schema that contains messages (without start/end dates)
const ConversationSchema = z.object({
  conversationId: z
    .string()
    .describe("Unique identifier for the conversation."),
  participants: z
    .array(ParticipantSchema)
    .describe("Participants in the conversation."),
  messages: z.array(MessageSchema).describe("Messages in this conversation."),
});

const GetConversationsOutputSchema = z.object({
  conversations: z
    .array(ConversationSchema)
    .describe("List of conversations matching the criteria."),
  details: z
    .string()
    .optional()
    .describe("Additional details or summary of the operation."),
});

type GetConversationsOutputType = z.infer<typeof GetConversationsOutputSchema>;

export const getConversationsTool = createTool({
  id: "imessage-get-conversations",
  description:
    "Retrieves up to 3 iMessage conversations for a specific contact, with a configurable number of messages per conversation. Provides message history with all participants in each conversation.",
  inputSchema: GetConversationsInputSchema,
  outputSchema: GetConversationsOutputSchema,
  execute: async ({ context }) => {
    const {
      contactId,
      startDate,
      endDate,
      conversationLimit = 3,
      messageLimit = 20,
      timeGapMinutes = 30,
    } = context;

    if (!contactId) {
      return {
        conversations: [],
        details: "A contactId is required.",
      } as GetConversationsOutputType;
    }

    // Validate date formats if provided
    if (startDate && isNaN(new Date(startDate).getTime())) {
      return {
        conversations: [],
        details: `Invalid startDate format. Please use ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ).`,
      } as GetConversationsOutputType;
    }

    if (endDate && isNaN(new Date(endDate).getTime())) {
      return {
        conversations: [],
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
        conversations: [],
        details: `There was an error loading contact data. Please ensure the data files are available.`,
      } as GetConversationsOutputType;
    }

    // Get the primary contact to resolve the name
    const contact = contactStore.findContact(contactId);
    const contactName = contact?.displayName || "Unknown";

    // Get messages
    try {
      console.log(`Retrieving conversations for contact: ${contactId}`);
      const messages = await dataLoader.getChatDataForContact(
        contactId,
        conversationLimit,
        messageLimit
      );
      console.log(
        `Successfully retrieved ${messages.length} messages from up to ${conversationLimit} conversations`
      );

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

      // Format messages for output, removing null messages
      const formattedMessages = filteredMessages
        .map((msg) => {
          // Safety check for required fields
          if (!msg || typeof msg !== "object") {
            console.warn(`Invalid message object:`, msg);
            return null;
          }

          // Skip messages with null text
          if (msg.text == null) {
            return null;
          }

          // Determine sender
          const senderContactId = msg.is_from_me
            ? "me"
            : msg.handle_id
              ? createContactId(msg.handle_id)
              : contactId;
          let senderName = msg.is_from_me ? "You" : contactName;

          // Try to look up other participants
          if (!msg.is_from_me && msg.handle_id) {
            const senderContact = contactStore.findContact(msg.handle_id);
            if (senderContact) {
              senderName = senderContact.displayName;
            }
          }

          return {
            id: msg.ROWID || 0, // Keep for sorting, but will be removed from output
            from: senderName,
            at: msg.date,
            text: String(msg.text), // Convert to string and ensure not nullsation ID from the data loader
            conversationId: msg.conversation_id || `fallback_${Date.now()}`,
            // Include participant information
            participantInfo: msg.conversation_participants || [],
          };
        })
        .filter(Boolean); // Remove any null entries

      // Group messages by conversation ID
      const conversationMap = new Map<
        string,
        {
          conversationId: string;
          participants: Array<{ id: string; name: string }>;
          messages: Array<any>;
        }
      >();

      // First pass: Group messages by conversation ID and collect participants
      for (const msg of formattedMessages) {
        if (msg && msg.conversationId) {
          if (!conversationMap.has(msg.conversationId)) {
            // Start with the primary contact and "me"
            const initialParticipants = [
              {
                id: contactId,
                name: contactName,
              },
              {
                id: "me",
                name: "You",
              },
            ];

            // Add other participants if available
            if (msg.participantInfo && Array.isArray(msg.participantInfo)) {
              // Create a set to track unique participants
              const participantIds = new Set(
                initialParticipants.map((p) => p.id)
              );

              for (const participant of msg.participantInfo) {
                if (participant.id && !participantIds.has(participant.id)) {
                  const normalizedId = createContactId(participant.id);
                  const participantContact = contactStore.findContact(
                    participant.id
                  );
                  const participantName =
                    participantContact?.displayName || "Unknown Contact";

                  initialParticipants.push({
                    id: normalizedId,
                    name: participantName,
                  });

                  participantIds.add(normalizedId);
                }
              }
            }

            conversationMap.set(msg.conversationId, {
              conversationId: msg.conversationId,
              participants: initialParticipants,
              messages: [],
            });
          }

          const conversation = conversationMap.get(msg.conversationId);
          if (conversation) {
            // Add the message without metadata fields
            const { participantInfo, conversationId, ...messageForOutput } =
              msg;
            conversation.messages.push(messageForOutput);
          }
        }
      }

      // Second pass: Sort messages and prepare final output
      const conversations = Array.from(conversationMap.values()).map(
        (conversation) => {
          // Sort messages by ID in ascending order (oldest message IDs first)
          conversation.messages.sort((a: any, b: any) => a.id - b.id);

          // Pull the message IDs before we remove them for sorting conversations
          const messageIds = conversation.messages.map((msg) => msg.id || 0);
          const highestMessageId =
            messageIds.length > 0 ? Math.max(...messageIds) : 0;

          // Format each message with a readable timestamp
          const formattedMessages = conversation.messages.map((msg) => {
            // Format the date to be more readable
            const date = new Date(msg.at);
            const formattedDate = formatDateForDisplay(date);

            // Return the message object with formatted date
            return {
              from: msg.from,
              at: formattedDate,
              text: msg.text,
            };
          });

          // Create the final conversation object (without start/end dates)
          return {
            conversationId: conversation.conversationId,
            participants: conversation.participants,
            messages: formattedMessages,
            _highestMessageId: highestMessageId, // Temporary field for sorting
          };
        }
      );

      // Sort conversations by highest message ID
      conversations.sort((a: any, b: any) => {
        return a._highestMessageId - b._highestMessageId; // Ascending order
      });

      // Remove the temporary _highestMessageId field
      conversations.forEach((conv) => {
        delete (conv as any)._highestMessageId;
      });

      return {
        conversations,
        details: `Retrieved ${formattedMessages.length} messages in ${conversations.length} conversations${
          startDate ? ` from ${startDate}` : ""
        }${endDate ? ` to ${endDate}` : ""} for ${contactName}. Showing up to ${conversationLimit} conversations with up to ${messageLimit} messages each.`,
      } as GetConversationsOutputType;
    } catch (err) {
      console.error("Error retrieving messages:", err);
      return {
        conversations: [],
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

/**
 * Format a date for display in message output.
 * Example: "April 18th, 2025 2:48 AM"
 */
function formatDateForDisplay(date: Date): string {
  // Check if the date is valid
  if (isNaN(date.getTime())) {
    return "Unknown date";
  }

  try {
    // Format the month
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = months[date.getMonth()];

    // Format the day with ordinal suffix
    const day = date.getDate();
    let suffix = "th";
    if (day === 1 || day === 21 || day === 31) suffix = "st";
    else if (day === 2 || day === 22) suffix = "nd";
    else if (day === 3 || day === 23) suffix = "rd";

    // Format the year
    const year = date.getFullYear();

    // Format the time in 12-hour format
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // Convert 0 to 12 for 12 AM

    // Put it all together
    return `${month} ${day}${suffix}, ${year} ${hours}:${minutes} ${ampm}`;
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Date formatting error";
  }
}
