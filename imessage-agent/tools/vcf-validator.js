#!/usr/bin/env node
/**
 * VCF Validator and Troubleshooting Tool
 *
 * This tool helps validate VCF files and diagnose common issues with parsing.
 * It provides detailed error messages and suggestions for fixing VCF files.
 */

import fs from "fs";
import path from "path";
import vcf from "vcf";

// Get file path from command line arguments
const filePath =
  process.argv[2] ||
  path.join(process.cwd(), "data", "user_data", "contacts.vcf");

console.log("VCF Validator and Troubleshooting Tool");
console.log("=====================================");
console.log(`Checking file: ${filePath}`);

// Check if file exists
if (!fs.existsSync(filePath)) {
  console.error(`❌ ERROR: File does not exist: ${filePath}`);
  console.log("\nPossible solutions:");
  console.log(
    "1. Check that you exported your contacts from the macOS Contacts app"
  );
  console.log("2. Make sure the file is in the correct location");
  console.log(
    "3. Run the tool with the path to your VCF file: node tools/vcf-validator.js /path/to/your/contacts.vcf"
  );
  process.exit(1);
}

// Check file size
const stats = fs.statSync(filePath);
console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
if (stats.size === 0) {
  console.error("❌ ERROR: File is empty");
  process.exit(1);
}

// Read and validate file
try {
  const content = fs.readFileSync(filePath, "utf-8");

  // Basic format checks
  console.log("\nPerforming basic format checks...");

  // Check for BEGIN:VCARD
  if (!content.includes("BEGIN:VCARD")) {
    console.error("❌ ERROR: File does not contain BEGIN:VCARD marker");
    console.log("\nPossible solutions:");
    console.log("1. Make sure you exported as vCard format (.vcf)");
    console.log("2. Check that the file is not corrupted");
    process.exit(1);
  }

  // Check for END:VCARD
  if (!content.includes("END:VCARD")) {
    console.error("❌ ERROR: File does not contain END:VCARD marker");
    console.log("\nPossible solutions:");
    console.log("1. The VCF file may be truncated or corrupted");
    console.log("2. Export the contacts again from the Contacts app");
    process.exit(1);
  }

  // Check version
  if (!content.includes("VERSION:")) {
    console.error("❌ WARNING: No VERSION field found in VCF");
    console.log("This might cause parsing issues");
  } else {
    // Extract version information
    const versionMatch = content.match(/VERSION:(\d+\.\d+)/);
    if (versionMatch) {
      const version = versionMatch[1];
      console.log(`VCF version: ${version}`);

      // Check if this version is supported
      if (!vcf.versions.includes(version)) {
        console.error(
          `❌ WARNING: Version ${version} may not be fully supported`
        );
        console.log(`Supported versions: ${vcf.versions.join(", ")}`);
      }
    }
  }

  // Check line endings
  const hasCRLF = content.includes("\r\n");
  const hasLF = content.includes("\n");

  if (!hasCRLF && hasLF) {
    console.log("⚠️ WARNING: File uses LF line endings instead of CRLF");
    console.log("This might cause parsing issues with some VCF parsers");
  }

  // Try parsing
  console.log("\nAttempting to parse VCF content...");
  try {
    const vcards = vcf.parse(content);
    console.log(`✅ Successfully parsed ${vcards.length} vCards`);

    // Show sample of the first vCard
    if (vcards.length > 0) {
      const firstCard = vcards[0];
      console.log("\nFirst vCard details:");
      const nameProperty = firstCard.get("fn");
      const name = nameProperty ? nameProperty.valueOf() : "Unknown";
      console.log(`Name: ${name}`);

      // Check for phone numbers
      const phone = firstCard.get("tel");
      if (phone) {
        console.log(`Phone: ${phone.valueOf()}`);
      } else {
        console.log("No phone numbers found in the first contact");
      }

      // Check for emails
      const email = firstCard.get("email");
      if (email) {
        console.log(`Email: ${email.valueOf()}`);
      } else {
        console.log("No email addresses found in the first contact");
      }
    }

    // Count contacts with phone and email
    let phoneCount = 0;
    let emailCount = 0;

    for (const card of vcards) {
      if (card.get("tel")) phoneCount++;
      if (card.get("email")) emailCount++;
    }

    console.log(
      `\nContacts with phone numbers: ${phoneCount} of ${vcards.length}`
    );
    console.log(
      `Contacts with email addresses: ${emailCount} of ${vcards.length}`
    );

    if (phoneCount === 0) {
      console.log("\n⚠️ WARNING: No phone numbers found in any contacts!");
      console.log("This might limit the usefulness of the iMessage agent.");
    }

    // Everything looks good
    console.log("\n✅ VCF file passed validation!");
  } catch (parseError) {
    console.error(`\n❌ VCF parsing error: ${parseError.message}`);

    // Provide specific error guidance
    if (parseError.message.includes("Unsupported version")) {
      console.log("\nPossible solutions:");
      console.log(
        "1. The VCF file has an unsupported version or corrupt version string"
      );
      console.log("2. Export the contacts again from the macOS Contacts app");
      console.log(
        '3. Make sure to select "vCard format (.vcf)" when exporting'
      );
    } else if (parseError.message.includes("Unexpected end")) {
      console.log("\nPossible solutions:");
      console.log("1. The VCF file appears to be truncated or corrupted");
      console.log("2. Try exporting the contacts again");
    } else {
      console.log("\nPossible solutions:");
      console.log(
        "1. Check if the file was properly exported from Contacts app"
      );
      console.log(
        "2. Try exporting a smaller set of contacts to isolate the issue"
      );
      console.log("3. Export as vCard 3.0 format if possible");
    }

    // Attempt to provide line number info if available
    if (parseError.lineNumber) {
      console.log(`\nError occurred around line ${parseError.lineNumber}`);

      // Try to show the problematic line
      const lines = content.split(/\r?\n/);
      if (lines.length >= parseError.lineNumber) {
        console.log("Problematic line:");
        console.log(lines[parseError.lineNumber - 1]);
      }
    }
  }
} catch (fileError) {
  console.error(`\n❌ Error reading file: ${fileError.message}`);
}

console.log(
  "\nFor additional help, refer to the iMessage Agent documentation:"
);
console.log("https://github.com/yourusername/imessage-agent#troubleshooting");
