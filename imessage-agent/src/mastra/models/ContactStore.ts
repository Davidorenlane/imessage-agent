import {
  ContactInfo,
  createContactInfo,
  normalizePhoneNumber,
  normalizeEmail,
  compareContactIds,
} from "../utils/contactNormalizer";

/**
 * Structure for a unified contact record with potential multiple identifiers.
 */
export interface Contact {
  contactId: string; // Primary normalized ID for this contact
  displayName: string; // Full name for display
  identifiers: ContactInfo[]; // All ways to reach this contact (multiple phones/emails)
  sources: string[]; // Where this contact info was found (e.g., ['vcf', 'chat.db'])
  lastUpdated: Date; // When this contact was last updated
}

/**
 * In-memory store for normalized contact information.
 * This could be replaced with a persistent database in a production environment.
 */
export class ContactStore {
  private contacts: Map<string, Contact> = new Map();
  private identifierToContactMap: Map<string, string> = new Map();

  /**
   * Add or update a contact from VCF or chat.db.
   *
   * @param rawIdentifier Phone number or email
   * @param displayName Name of the contact
   * @param source Where this contact info came from (e.g., 'vcf' or 'chat.db')
   * @returns The created or updated contact
   */
  public addOrUpdateContact(
    rawIdentifier: string,
    displayName: string,
    source: string = "unknown"
  ): Contact {
    // Create ContactInfo with normalized ID
    const contactInfo = createContactInfo(rawIdentifier, displayName, source);

    // Check if this identifier already maps to a contact
    let existingContactId = this.identifierToContactMap.get(contactInfo.id);

    if (existingContactId) {
      // Update existing contact
      return this.updateExistingContact(
        existingContactId,
        contactInfo,
        displayName,
        source
      );
    } else {
      // Try fuzzy matching with existing identifiers
      const matchedContactId = this.findBestMatchingContactId(
        contactInfo.rawValue
      );

      if (matchedContactId) {
        // Update matched contact
        return this.updateExistingContact(
          matchedContactId,
          contactInfo,
          displayName,
          source
        );
      } else {
        // Create new contact
        return this.createNewContact(contactInfo, displayName, source);
      }
    }
  }

  /**
   * Find a contact by their normalized identifier.
   *
   * @param identifier Raw phone or email to search for
   * @returns The contact if found, undefined otherwise
   */
  public findContact(identifier: string): Contact | undefined {
    const contactInfo = createContactInfo(identifier);

    // First try direct lookup
    const contactId = this.identifierToContactMap.get(contactInfo.id);
    if (contactId) {
      return this.contacts.get(contactId);
    }

    // Then try fuzzy matching
    const bestMatchId = this.findBestMatchingContactId(identifier);
    if (bestMatchId) {
      return this.contacts.get(bestMatchId);
    }

    return undefined;
  }

  /**
   * Get all contacts in the store.
   *
   * @returns Array of all contacts
   */
  public getAllContacts(): Contact[] {
    return Array.from(this.contacts.values());
  }

  /**
   * Find contacts that match a search query (name or identifier).
   *
   * @param query Text to search for in names or identifiers
   * @returns Array of matching contacts
   */
  public searchContacts(query: string): Contact[] {
    query = query.toLowerCase();

    return Array.from(this.contacts.values()).filter((contact) => {
      // Match on display name
      if (contact.displayName.toLowerCase().includes(query)) {
        return true;
      }

      // Match on any identifier
      return contact.identifiers.some(
        (identifier) =>
          identifier.rawValue.toLowerCase().includes(query) ||
          identifier.normalizedValue.toLowerCase().includes(query)
      );
    });
  }

  /**
   * Get stats about the contact store.
   *
   * @returns Object with contact count statistics
   */
  public getStats(): {
    totalContacts: number;
    phoneContacts: number;
    emailContacts: number;
    vcfSourceCount: number;
    chatDbSourceCount: number;
  } {
    let phoneContacts = 0;
    let emailContacts = 0;
    let vcfSourceCount = 0;
    let chatDbSourceCount = 0;

    this.contacts.forEach((contact) => {
      if (contact.identifiers.some((id) => id.type === "phone")) {
        phoneContacts++;
      }
      if (contact.identifiers.some((id) => id.type === "email")) {
        emailContacts++;
      }
      if (contact.sources.includes("vcf")) {
        vcfSourceCount++;
      }
      if (contact.sources.includes("chat.db")) {
        chatDbSourceCount++;
      }
    });

    return {
      totalContacts: this.contacts.size,
      phoneContacts,
      emailContacts,
      vcfSourceCount,
      chatDbSourceCount,
    };
  }

  /**
   * Clear all contacts from the store.
   */
  public clear(): void {
    this.contacts.clear();
    this.identifierToContactMap.clear();
  }

  // Helper methods

  private updateExistingContact(
    contactId: string,
    newIdentifier: ContactInfo,
    displayName: string,
    source: string
  ): Contact {
    const contact = this.contacts.get(contactId);

    if (!contact) {
      // This should not happen, but handle gracefully
      return this.createNewContact(newIdentifier, displayName, source);
    }

    // Check if we already have this exact identifier
    const hasIdentifier = contact.identifiers.some(
      (id) => id.id === newIdentifier.id
    );

    if (!hasIdentifier) {
      // Add new identifier
      contact.identifiers.push(newIdentifier);
      this.identifierToContactMap.set(newIdentifier.id, contactId);
    }

    // Update sources if needed
    if (!contact.sources.includes(source)) {
      contact.sources.push(source);
    }

    // Update name if we have a better one (prefer VCF over chat.db)
    if (
      (source === "vcf" && !contact.sources.includes("vcf")) ||
      (contact.displayName === "Unknown" && displayName !== "Unknown")
    ) {
      contact.displayName = displayName;
    }

    // Update timestamp
    contact.lastUpdated = new Date();

    return contact;
  }

  private createNewContact(
    identifier: ContactInfo,
    displayName: string,
    source: string
  ): Contact {
    const contact: Contact = {
      contactId: identifier.id,
      displayName,
      identifiers: [identifier],
      sources: [source],
      lastUpdated: new Date(),
    };

    this.contacts.set(contact.contactId, contact);
    this.identifierToContactMap.set(identifier.id, contact.contactId);

    return contact;
  }

  private findBestMatchingContactId(rawIdentifier: string): string | undefined {
    let bestMatchScore = 0;
    let bestMatchId: string | undefined;

    // Check against all existing identifiers for fuzzy matches
    this.contacts.forEach((contact) => {
      contact.identifiers.forEach((identifier) => {
        const score = compareContactIds(rawIdentifier, identifier.rawValue);

        if (score > 0.8 && score > bestMatchScore) {
          bestMatchScore = score;
          bestMatchId = contact.contactId;
        }
      });
    });

    return bestMatchId;
  }
}
