# iMessage Agent

This is an AI agent designed to interact with your iMessage (chat.db) and contacts (contacts.vcf) data to provide insights, retrieve conversations, and analyze messages.

## Setup

### Required Files

To use the iMessage Agent, you'll need to have access to the following files:

1. **chat.db**: This is your iMessage database file, located at `~/Library/Messages/chat.db` on your Mac.
2. **contacts.vcf**: This is your contacts file which can be exported from the macOS Contacts app.

### Installation

1. Clone this repository:

   ```
   git clone https://github.com/yourusername/imessage-agent.git
   cd imessage-agent
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set up your data files:

   ```
   mkdir -p data/user_data
   ```

4. Copy your files (with read-only access for safety):

   ```
   # Copy your chat database (may require administrative access)
   cp -R ~/Library/Messages/chat.db data/user_data/

   # Export contacts.vcf from the macOS Contacts app and place it in data directory
   # Contacts app > File > Export > Export vCard...
   # Then move the file to data/user_data/contacts.vcf
   ```

## Usage

The iMessage Agent provides several tools to work with your messages and contacts:

1. **Find Contact**: Locate contacts by name, phone number, or email. Supports fuzzy matching and reconciliation between VCF contacts and chat.db handles.

2. **Get Conversations**: Retrieve messages for a specific contact. Can filter by date range.

3. **Count Messages**: Count messages or contacts across various criteria.

## Core Features

- Phone number and email normalization for consistent contact identification
- Reconciliation between contact names and phone numbers
- VCF parsing and SQLite database connections
- In-memory contact store that merges information from both sources

## Security & Privacy

Your data remains local, as the agent processes everything on your machine. The chat.db and contacts.vcf files are never uploaded to any server.

## Development

- The agent is built using [Mastra](https://mastrajs.com), a framework for building AI agents
- The core functionality is in the `src/mastra` directory
- Contact normalization utilities are in `src/mastra/utils/contactNormalizer.ts`
- Data loading from files is in `src/mastra/utils/dataLoader.ts`

## Limitations

- The agent works with SQLite and VCF parsing, so it's designed for Mac users with iMessage
- Group chats may not be fully supported in the current version
- Date filters are based on message timestamps and may not include all attachment data

## Troubleshooting

### Comprehensive Troubleshooting Tool

The easiest way to diagnose issues is to use the built-in troubleshooting tool:

```
node tools/troubleshoot.js
```

This tool will:

- Check your data directory setup
- Validate your VCF file format and content
- Test the SQLite database connection
- Provide specific recommendations to fix any issues

### VCF File Issues

If you're experiencing problems with contacts not loading, follow these steps:

1. **Run the VCF validator tool:**

   ```
   node tools/vcf-validator.js
   ```

   This will check your contacts.vcf file and identify common issues.

2. **Common VCF problems:**

   - **"vcf.parse is not a function"**: This error occurs if there's an issue with the VCF library import. Make sure you have installed all dependencies with `npm install`.
   - **"Unsupported version" error**: Make sure your VCF file uses a supported format (2.1, 3.0, or 4.0).
   - **Empty contacts list**: Check that your VCF file contains valid phone numbers and emails.
   - **Line ending issues**: VCF files should use CRLF (`\r\n`) line endings. The validator will check this.

3. **Re-export your contacts:**
   If problems persist, try re-exporting your contacts from the macOS Contacts app:

   - Open Contacts app
   - Select the contacts you want to export
   - Go to File > Export > Export vCard...
   - Save the file to `data/user_data/contacts.vcf`

4. **Enable debug mode:**
   You can enable detailed logging by setting the `debug` option to true when creating the DataLoader:
   ```javascript
   const dataLoader = new DataLoader(contactStore, { debug: true });
   ```

### SQLite Database Issues

If you're having trouble with the chat.db file:

1. **Check file permissions:**
   The chat.db file should be readable by your application. You may need to adjust permissions or copy it to the data directory with proper access rights.

2. **Database busy or locked errors:**
   This can happen if Messages app is using the database. Close Messages or make a copy of the database file instead of using the original.

3. **File not found errors:**
   Make sure the file path is correct. The default location is `data/user_data/chat.db`.
