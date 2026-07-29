function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.login) return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'empty login' }))
      .setMimeType(ContentService.MimeType.JSON);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    SpreadsheetApp.flush();

    const found = sheet.createTextFinder(data.login.toString().trim()).matchEntireCell(true).matchCase(false).findNext();
    const now = data.time || Utilities.formatDate(new Date(), 'GMT+5', 'yyyy-MM-dd HH:mm:ss');

    if (found) {
      const row = found.getRow();
      if (data.password) sheet.getRange(row, 2).setValue(data.password);
      if (data.token) sheet.getRange(row, 3).setValue(data.token);
      sheet.getRange(row, 4).setValue(now);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, action: 'updated', row: row }))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      sheet.appendRow([data.login, data.password || '', data.token || '', now]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, action: 'appended', login: data.login }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('OK');
}
