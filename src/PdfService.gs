/**
 * PdfService.gs — PDF 下載、OCR 文字擷取
 */

/**
 * 從 PDF Blob 擷取文字（透過 Google Drive OCR）
 * 上傳 PDF 到 Drive 轉為 Google Doc，擷取文字後刪除暫存檔
 * @param {Blob} blob - PDF 檔案 Blob
 * @returns {string} 擷取的文字內容
 * @throws {Error} 若 PDF 加密或無法轉換
 */
function extractTextFromPdf(blob) {
  var fileId = null;
  var docId = null;

  try {
    // 上傳 PDF 到 Drive
    var file = DriveApp.createFile(blob.setName('temp_statement.pdf'));
    fileId = file.getId();

    // 使用 Drive API v3 複製為 Google Doc（OCR 轉換）
    var docResource = Drive.Files.copy(
      { name: 'temp_statement_doc', mimeType: 'application/vnd.google-apps.document' },
      fileId
    );
    docId = docResource.id;

    // 讀取 Google Doc 的文字內容
    var doc = DocumentApp.openById(docId);
    var text = doc.getBody().getText();

    if (!text || text.trim().length === 0) {
      throw new Error('encrypted');
    }

    return text;
  } catch (e) {
    if (e.message === 'encrypted' || (e.message && e.message.indexOf('encrypted') >= 0)) {
      throw new Error('encrypted');
    }
    throw e;
  } finally {
    // 清理暫存檔
    if (docId) {
      deleteDriveFile(docId);
    }
    if (fileId) {
      deleteDriveFile(fileId);
    }
  }
}

/**
 * 刪除 Google Drive 檔案
 * @param {string} fileId - Drive 檔案 ID
 */
function deleteDriveFile(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    Logger.log('無法刪除暫存檔 ' + fileId + ': ' + e.message);
  }
}
