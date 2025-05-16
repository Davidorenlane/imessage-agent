#!/usr/bin/env node
/**
 * iMessage Agent Troubleshooting Tool
 *
 * This tool helps diagnose and fix common issues with the iMessage Agent.
 * It can check VCF files, SQLite database access, and data directory setup.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vcf from "vcf";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data", "user_data");
const vcfPath = path.join(dataDir, "contacts.vcf");
const dbPath = path.join(dataDir, "chat.db");

// ANSI color codes for better console output
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
};

// Print colored text
function colorPrint(color, text) {
  console.log(`${COLORS[color]}${text}${COLORS.reset}`);
}

// Section header
function printHeader(text) {
  console.log("\n" + "=".repeat(60));
  colorPrint("bold", text);
  console.log("=".repeat(60));
}

// Success message
function success(text) {
  colorPrint("green", `✅ ${text}`);
}

// Warning message
function warning(text) {
  colorPrint("yellow", `⚠️ ${text}`);
}

// Error message
function error(text) {
  colorPrint("red", `❌ ${text}`);
}

// Info message
function info(text) {
  colorPrint("cyan", `ℹ️ ${text}`);
}

// Fix data dir issues
async function checkAndFixDataDir() {
  printHeader("CHECKING DATA DIRECTORY");

  if (!fs.existsSync(dataDir)) {
    error(`Data directory not found: ${dataDir}`);
    info("Creating data directory...");

    try {
      fs.mkdirSync(dataDir, { recursive: true });
      success(`Created data directory at: ${dataDir}`);
    } catch (err) {
      error(`Failed to create data directory: ${err.message}`);
      return false;
    }
  } else {
    success(`Data directory exists at: ${dataDir}`);
  }

  return true;
}

// Check VCF file
async function checkVcfFile() {
  printHeader("CHECKING VCF FILE");

  if (!fs.existsSync(vcfPath)) {
    error(`Contacts VCF file not found: ${vcfPath}`);
    info("Expected location: data/user_data/contacts.vcf");
    info(
      "Export your contacts from the macOS Contacts app, then place the file in this location."
    );
    return false;
  }

  const stats = fs.statSync(vcfPath);
  info(`VCF file size: ${(stats.size / 1024).toFixed(2)} KB`);

  if (stats.size === 0) {
    error("VCF file is empty");
    return false;
  }

  try {
    const content = fs.readFileSync(vcfPath, "utf-8");

    // Basic format checks
    if (!content.includes("BEGIN:VCARD")) {
      error("File does not contain BEGIN:VCARD marker");
      return false;
    }

    if (!content.includes("END:VCARD")) {
      error("File does not contain END:VCARD marker");
      return false;
    }

    // Version check
    if (content.includes("VERSION:")) {
      const versionMatch = content.match(/VERSION:(\d+\.\d+)/);
      if (versionMatch) {
        const version = versionMatch[1];
        info(`VCF version: ${version}`);

        if (!vcf.versions.includes(version)) {
          warning(`Version ${version} may not be fully supported`);
          info(`Supported versions: ${vcf.versions.join(", ")}`);
        }
      }
    } else {
      warning("No VERSION field found in VCF");
    }

    // Line endings check
    const hasCRLF = content.includes("\r\n");
    const hasLF = content.includes("\n");

    if (!hasCRLF && hasLF) {
      warning("File uses LF line endings instead of CRLF");
      info("This might cause parsing issues with some VCF parsers");
    }

    // Try parsing
    info("Attempting to parse VCF content...");
    try {
      const vcards = vcf.parse(content);
      success(`Successfully parsed ${vcards.length} vCards`);

      // Count contacts with phone and email
      let phoneCount = 0;
      let emailCount = 0;

      for (const card of vcards) {
        if (card.get("tel")) phoneCount++;
        if (card.get("email")) emailCount++;
      }

      info(`Contacts with phone numbers: ${phoneCount} of ${vcards.length}`);
      info(`Contacts with email addresses: ${emailCount} of ${vcards.length}`);

      if (phoneCount === 0) {
        warning("No phone numbers found in any contacts!");
        info("This might limit the usefulness of the iMessage agent.");
      }

      return true;
    } catch (parseError) {
      error(`VCF parsing error: ${parseError.message}`);
      return false;
    }
  } catch (fileError) {
    error(`Error reading VCF file: ${fileError.message}`);
    return false;
  }
}

// Check chat.db file
async function checkChatDb() {
  printHeader("CHECKING CHAT.DB FILE");

  if (!fs.existsSync(dbPath)) {
    error(`Chat database file not found: ${dbPath}`);
    info("Expected location: data/user_data/chat.db");
    info(
      "Copy your chat.db file from ~/Library/Messages/chat.db to this location."
    );
    return false;
  }

  const stats = fs.statSync(dbPath);
  info(`SQLite file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  if (stats.size === 0) {
    error("Chat.db file is empty");
    return false;
  }

  info("Attempting to open SQLite database...");

  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });

    // Test handle table
    try {
      const handleCount = await db.get("SELECT COUNT(*) as count FROM handle");
      success(
        `Successfully accessed handle table with ${handleCount.count} records`
      );

      // Test message table
      try {
        const messageCount = await db.get(
          "SELECT COUNT(*) as count FROM message LIMIT 1"
        );
        success(
          `Successfully accessed message table with ${messageCount.count} total messages`
        );

        // Test join query
        try {
          const sampleMessages = await db.all(`
            SELECT message.ROWID, message.text, message.date, handle.id 
            FROM message 
            JOIN handle ON message.handle_id = handle.ROWID
            LIMIT 5
          `);

          success(
            `Successfully queried joined tables with ${sampleMessages.length} sample messages`
          );
          await db.close();
          return true;
        } catch (joinErr) {
          error(`Error joining tables: ${joinErr.message}`);
          warning("This may indicate a schema mismatch or corrupt database");
          await db.close();
          return false;
        }
      } catch (messageErr) {
        error(`Error accessing message table: ${messageErr.message}`);
        await db.close();
        return false;
      }
    } catch (handleErr) {
      error(`Error accessing handle table: ${handleErr.message}`);
      await db.close();
      return false;
    }
  } catch (dbErr) {
    error(`Error opening database: ${dbErr.message}`);
    if (dbErr.message.includes("SQLITE_CANTOPEN")) {
      info("This may be due to file permissions or a corrupt database file.");
    }
    return false;
  }
}

// Run all checks
async function runAllChecks() {
  printHeader("IMESSAGE AGENT TROUBLESHOOTING");
  info("This tool will help diagnose common issues with the iMessage Agent");

  const dirOk = await checkAndFixDataDir();
  if (!dirOk) {
    error("Data directory issues must be resolved before continuing");
    return;
  }

  const vcfOk = await checkVcfFile();
  const dbOk = await checkChatDb();

  printHeader("TROUBLESHOOTING SUMMARY");

  if (vcfOk && dbOk) {
    success("All checks passed! Your iMessage Agent should work correctly.");
  } else {
    if (!vcfOk) {
      error("VCF file check failed - see errors above");
      info("For detailed VCF validation, run: node tools/vcf-validator.js");
    }

    if (!dbOk) {
      error("Chat.db check failed - see errors above");
    }

    info("\nSuggested next steps:");
    if (!vcfOk) {
      info("1. Re-export your contacts from macOS Contacts app");
      info("2. Make sure to select vCard format (.vcf)");
    }

    if (!dbOk) {
      info("1. Check file permissions on chat.db");
      info("2. Create a fresh copy of chat.db from ~/Library/Messages/chat.db");
    }
  }

  info("\nFor more help, refer to the README.md troubleshooting section.");
}

// Run everything
runAllChecks().catch((err) => {
  error(`Unexpected error during troubleshooting: ${err.message}`);
  console.error(err);
});
