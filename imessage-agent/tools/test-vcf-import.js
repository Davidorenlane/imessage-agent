// Test script for importing and using the vcf library correctly
import fs from "fs";
import path from "path";
import vcf from "vcf";

// Sample VCF content with proper line endings
// Each line must be separated by \r\n according to the VCF spec
const SAMPLE_VCF = `BEGIN:VCARD\r
VERSION:3.0\r
FN:John Doe\r
TEL;TYPE=CELL:+1 (555) 123-4567\r
EMAIL:john@example.com\r
END:VCARD\r
BEGIN:VCARD\r
VERSION:3.0\r
FN:Jane Smith\r
TEL;TYPE=WORK:(123) 456-7890\r
EMAIL:jane@example.com\r
END:VCARD`;

// Save sample to temporary file
const tempFile = path.join(process.cwd(), "test-contacts.vcf");
fs.writeFileSync(tempFile, SAMPLE_VCF);
console.log(`Created test VCF file at: ${tempFile}`);

// Test parsing
try {
  console.log("Attempting to parse VCF content...");

  // Show details about the library
  console.log("VCF library version support:", vcf.versions);
  console.log("VCF parse function type:", typeof vcf.parse);

  // Test file parsing first
  console.log("\nReading VCF file and parsing...");
  const vcfContent = fs.readFileSync(tempFile, "utf-8");
  const vcardsFromFile = vcf.parse(vcfContent);
  console.log(`Successfully parsed ${vcardsFromFile.length} vCards from file`);

  // Examine first vCard
  const firstCard = vcardsFromFile[0];
  console.log("\nFirst vCard details:");
  const fnProp = firstCard.get("fn");
  console.log("- Name:", fnProp ? fnProp.valueOf() : "Unknown");

  const phone = firstCard.get("tel");
  if (phone) {
    console.log("- Phone:", phone.valueOf());
  }

  const email = firstCard.get("email");
  if (email) {
    console.log("- Email:", email.valueOf());
  }

  console.log("\n✅ VCF parsing test completed successfully");

  // Log all available properties
  console.log("\nAll properties of the first vCard:");
  // Get all properties by checking common ones
  const commonProps = [
    "version",
    "fn",
    "n",
    "tel",
    "email",
    "adr",
    "org",
    "title",
    "url",
  ];
  for (const prop of commonProps) {
    const value = firstCard.get(prop);
    if (value) {
      console.log(`- ${prop}: ${value.valueOf()}`);
    }
  }
} catch (err) {
  console.error("\n❌ Error in VCF parsing test:", err);
  if (err instanceof Error) {
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
  }
} finally {
  // Clean up
  fs.unlinkSync(tempFile);
  console.log("Cleaned up test file");
}
