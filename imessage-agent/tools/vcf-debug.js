// Simple script to debug the VCF library structure
import pkg from "vcf";

console.log("VCF import type:", typeof pkg);
console.log("VCF keys:", Object.keys(pkg));
console.log(
  "VCF structure:",
  JSON.stringify(
    pkg,
    (key, value) => (typeof value === "function" ? "function()" : value),
    2
  )
);

// Check if the documented API functions exist
console.log(
  "Has parse method on default import:",
  typeof pkg.parse === "function"
);
console.log(
  "Has VCard property:",
  typeof pkg.VCard === "function" || typeof pkg.VCard === "object"
);

// If pkg is a constructor function itself
if (typeof pkg === "function") {
  console.log("VCF is a function itself, checking its prototype");
  console.log("VCF function prototype:", Object.keys(pkg.prototype || {}));
}

// Try to access the library in different ways
console.log("\nExploring different ways to access functionality:");
console.log("pkg.default:", pkg.default ? "exists" : "undefined");
if (pkg.default) {
  console.log("  Type:", typeof pkg.default);
  console.log("  Has parse method:", typeof pkg.default.parse === "function");
}
