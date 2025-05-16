/**
 * Utilities for normalizing contact identifiers (phone numbers and emails)
 * to enable consistent matching between contacts.vcf and chat.db.
 */

/**
 * Normalizes a phone number to a standard E.164 format when possible.
 * Removes all non-digit characters and ensures proper country code formatting.
 *
 * @param phoneNumber The phone number to normalize in any format
 * @param defaultCountryCode The country code to apply if not present (default: '1' for US/Canada)
 * @returns Normalized phone number in E.164 format (e.g., +12125551234)
 */
export function normalizePhoneNumber(
  phoneNumber: string,
  defaultCountryCode = "1"
): string {
  if (!phoneNumber) return "";

  // Strip all non-digit characters
  let digits = phoneNumber.replace(/\D/g, "");

  // Handle international format (starts with + or 00)
  if (phoneNumber.startsWith("+")) {
    // Already has a plus, just remove all non-digits
    return "+" + digits;
  } else if (phoneNumber.startsWith("00")) {
    // Double zero international format, convert to +
    return "+" + digits.substring(2);
  }

  // Check for country code (typically length >= 11 for US numbers with country code)
  if (
    digits.length >= 11 &&
    (digits.startsWith("1") || digits.startsWith(defaultCountryCode))
  ) {
    return "+" + digits;
  }

  // Assume no country code, add the default
  return "+" + defaultCountryCode + digits;
}

/**
 * Normalizes an email address to lowercase.
 *
 * @param email The email address to normalize
 * @returns Normalized lowercase email address
 */
export function normalizeEmail(email: string): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

/**
 * Determines if a string is likely a phone number.
 *
 * @param input The string to check
 * @returns true if the string appears to be a phone number
 */
export function isLikelyPhoneNumber(input: string): boolean {
  // Check if string contains at least some digits
  if (!/\d/.test(input)) return false;

  // Check if the digit ratio is high (phone numbers are mostly digits)
  const digitRatio = (input.match(/\d/g) || []).length / input.length;
  return digitRatio > 0.5;
}

/**
 * Determines if a string is likely an email address.
 *
 * @param input The string to check
 * @returns true if the string appears to be an email address
 */
export function isLikelyEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

/**
 * Creates a unified contact ID by normalizing a phone number or email address.
 *
 * @param input A phone number or email address
 * @returns A normalized identifier suitable for cross-referencing
 */
export function createContactId(input: string): string {
  if (!input) return "";

  // Normalize based on input type
  if (isLikelyEmail(input)) {
    return `email:${normalizeEmail(input)}`;
  } else if (isLikelyPhoneNumber(input)) {
    return `phone:${normalizePhoneNumber(input)}`;
  }

  // If we can't determine the type, return as-is with unknown prefix
  return `unknown:${input.trim()}`;
}

/**
 * Extract the phone number or email from a normalized contact ID.
 *
 * @param contactId A normalized contact ID (e.g., 'phone:+12125551234')
 * @returns The phone number or email portion of the ID
 */
export function extractContactValue(contactId: string): string {
  if (!contactId) return "";

  const parts = contactId.split(":");
  if (parts.length >= 2) {
    return parts.slice(1).join(":"); // In case the value portion contains colons
  }

  return contactId; // Return as-is if not in expected format
}

/**
 * Extracts the type of a normalized contact ID.
 *
 * @param contactId A normalized contact ID
 * @returns The type portion ('phone', 'email', or 'unknown')
 */
export function getContactIdType(
  contactId: string
): "phone" | "email" | "unknown" {
  if (!contactId) return "unknown";

  if (contactId.startsWith("phone:")) return "phone";
  if (contactId.startsWith("email:")) return "email";

  return "unknown";
}

/**
 * Contact information object structure.
 */
export interface ContactInfo {
  id: string; // Normalized ID (e.g., 'phone:+12125551234')
  displayName?: string; // Full name from contacts
  rawValue: string; // Original value before normalization
  type: "phone" | "email" | "unknown";
  normalizedValue: string; // Value after normalization
  source?: string; // Where this contact info came from (e.g., 'vcf', 'chat.db')
}

/**
 * Creates a ContactInfo object from a raw phone number or email.
 *
 * @param rawValue Original phone number or email
 * @param displayName Optional contact name
 * @param source Where this contact info came from
 * @returns Structured ContactInfo object
 */
export function createContactInfo(
  rawValue: string,
  displayName?: string,
  source?: string
): ContactInfo {
  // Determine type and normalize
  const isPhone = isLikelyPhoneNumber(rawValue);
  const isEmail = isLikelyEmail(rawValue);

  let type: "phone" | "email" | "unknown" = "unknown";
  let normalizedValue = rawValue;

  if (isPhone) {
    type = "phone";
    normalizedValue = normalizePhoneNumber(rawValue);
  } else if (isEmail) {
    type = "email";
    normalizedValue = normalizeEmail(rawValue);
  }

  // Create ID with prefix
  const id = `${type}:${normalizedValue}`;

  return {
    id,
    displayName,
    rawValue,
    type,
    normalizedValue,
    source,
  };
}

/**
 * Compares two contact identifiers (phone numbers or emails) for fuzzy matching.
 * Returns a similarity score between 0 and 1.
 *
 * @param id1 First contact identifier (raw or normalized)
 * @param id2 Second contact identifier (raw or normalized)
 * @returns Similarity score between 0 and 1
 */
export function compareContactIds(id1: string, id2: string): number {
  if (!id1 || !id2) return 0;

  // Normalize both for comparison
  const normalized1 = createContactId(id1);
  const normalized2 = createContactId(id2);

  // If they're exactly the same after normalization
  if (normalized1 === normalized2) return 1;

  // Extract the type and value
  const type1 = getContactIdType(normalized1);
  const type2 = getContactIdType(normalized2);

  // If types don't match, they're definitely different
  if (type1 !== type2) return 0;

  // For phones, additional comparison of just the last 7-10 digits
  if (type1 === "phone" && type2 === "phone") {
    const value1 = extractContactValue(normalized1).replace(/\D/g, "");
    const value2 = extractContactValue(normalized2).replace(/\D/g, "");

    // Compare last 7 digits (local part of phone number)
    if (value1.length >= 7 && value2.length >= 7) {
      const last7of1 = value1.slice(-7);
      const last7of2 = value2.slice(-7);

      if (last7of1 === last7of2) return 0.9; // High confidence but not 100%
    }

    // Compare last 10 digits (area code + local part)
    if (value1.length >= 10 && value2.length >= 10) {
      const last10of1 = value1.slice(-10);
      const last10of2 = value2.slice(-10);

      if (last10of1 === last10of2) return 0.95; // Very high confidence
    }
  }

  // For emails, we could implement domain-specific matching if needed

  // Default - different
  return 0;
}
