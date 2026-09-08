export async function saveJsonFile(value, fileName) {
  await saveTextFile(JSON.stringify(value, null, 2), fileName, "application/json");
}

export async function saveTextFile(text, fileName, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
