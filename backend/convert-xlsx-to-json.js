const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

// Excel file is inside backend folder
const inputFile = path.join(__dirname, "Books_Dataset.xlsx");
const outputFile = path.join(__dirname, "Books_Dataset.json");

try {
  const workbook = XLSX.readFile(inputFile);
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  const data = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  });

  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), "utf-8");

  console.log(`✅ JSON created successfully: ${outputFile}`);
  console.log(`Rows converted: ${data.length}`);
} catch (err) {
  console.error("❌ Failed to convert XLSX to JSON:", err.message);
}