# iMessage Agent

This is an AI agent designed to interact with your iMessage (chat.db) and contacts (contacts.vcf) data to provide insights, retrieve conversations, and analyze messages.

## Setup

### Required Files

To use the iMessage Agent, you'll need to have access to the following files:

1. **chat.db**: This is your iMessage database file, located at `~/Library/Messages/chat.db` on your Mac.
2. **contacts.vcf**: This is your contacts file which can be exported from the macOS Contacts app.

Both of these files will need to be placed in the `.mastra/output/data/user_data` directory after starting the development server.

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

3. Start the development server:

   ```
   npm run dev
   ```

4. Set up your data directory:

   ```
   mkdir -p .mastra/output/data/user_data
   ```

   > Note: The `.mastra/output` directory is generated during the build process and is where the runtime expects to find your data files.

5. Copy your files:

   ```
   # Copy your chat database (may require administrative access)
   cp -R ~/Library/Messages/chat.db .mastra/output/data/user_data/

   # Export contacts.vcf from the macOS Contacts app and place it in data directory
   # Contacts app > File > Export > Export vCard...
   # Then move the file to .mastra/output/data/user_data/contacts.vcf
   ```

   > **Important**: Do not place the files directly in the project's `data/user_data` directory. They must be in the `.mastra/output/data/user_data` directory to be accessible to the running application.

## Usage

The iMessage Agent provides several tools to work with your messages and contacts:

1. **Find Contact**: Locate contacts by name, phone number, or email. Supports fuzzy matching and reconciliation between VCF contacts and chat.db handles.

2. **Get Conversations**: Retrieve conversations for a specific contact.

   - Retrieves up to 3 most recent conversations involving the contact by default
   - Each conversation includes all participants (not just the primary contact)
   - Messages are grouped by actual conversation threads from the database
   - Includes the following for each conversation:
     - Unique conversation ID
     - Complete list of participants with names
     - Messages in descending order by message ID (newest first)
   - Messages are returned as objects with:
     - `from`: Name of the sender
     - `at`: Readable timestamp (like "April 18th, 2025 2:48 PM")
     - `text`: Message content
   - Configurable number of messages per conversation (default: 20)
   - Can filter by date range

3. **Count Messages**: Count messages or contacts across various criteria.

## Core Features

- Phone number and email normalization for consistent contact identification
- Reconciliation between contact names and phone numbers
- VCF parsing and SQLite database connections
- In-memory contact store that merges information from both sources
- Multi-participant conversation support with proper threading
- Human-readable message formatting with nicely formatted timestamps

## Security & Privacy

This version sends your data to OpenAI, but my goal is to eventually move to a self-hosted solution, which seems pretty doable with Mastra! Sort of relies on how good the small open source models get!

## Development

- The agent is built using [Mastra](https://mastrajs.com), a framework for building AI agents
- The core functionality is in the `src/mastra` directory
- Contact normalization utilities are in `src/mastra/utils/contactNormalizer.ts`
- Data loading from files is in `src/mastra/utils/dataLoader.ts`

## Limitations

- The agent works with SQLite and VCF parsing, so it's designed for Mac users with iMessage
- Group chats are supported but may have limitations in correctly identifying all participants
- Date filters are based on message timestamps and may not include all attachment data
- The agent retrieves up to 3 conversations at a time to prevent excessive data loading
- Messages with null content are excluded from results

# LOL Claude went off the rails a little starting here :)

Have not tried any of this yet -->

## Troubleshooting

### Comprehensive Troubleshooting Tool

The easiest way to diagnose issues is to use the built-in troubleshooting tool:

```
node tools/troubleshoot.js
```

This tool will:

- Check your data directory setup in `.mastra/output/data/user_data`
- Validate your VCF file format and content
- Test the SQLite database connection
- Provide specific recommendations to fix any issues

### VCF File Issues

If you're experiencing problems with contacts not loading, follow these steps:

1. **Run the VCF validator tool:**

   ```
   node tools/vcf-validator.js .mastra/output/data/user_data/contacts.vcf
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
   - Save the file to `.mastra/output/data/user_data/contacts.vcf`

4. **Enable debug mode:**
   You can enable detailed logging by setting the `debug` option to true when creating the DataLoader:
   ```javascript
   const dataLoader = new DataLoader(contactStore, { debug: true });
   ```

### SQLite Database Issues

If you're having trouble with the chat.db file:

1. **Check file permissions:**
   The chat.db file should be readable by your application. You may need to adjust permissions or copy it to the correct data directory with proper access rights.

2. **Database busy or locked errors:**
   This can happen if Messages app is using the database. Close Messages or make a copy of the database file instead of using the original.

3. **File not found errors:**
   Make sure the file path is correct. The required location is `.mastra/output/data/user_data/chat.db`.
