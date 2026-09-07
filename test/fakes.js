function fakeSheetWithHeader(header, rows) {
  const data = [header].concat(rows);
  return {
    _data: data,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; }),
      setValues: (vals) => { for (let i = 0; i < vals.length; i++) { const row = data[r - 1 + i] || (data[r - 1 + i] = []); for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j]; } },
      setValue: (v) => { data[r - 1][c - 1] = v; }
    }),
    deleteRow: (r) => { data.splice(r - 1, 1); }
  };
}
function fakeSheet(rows) {
  return fakeSheetWithHeader(['日期','金融機構','帳戶名稱','類型','分類','品項','明細描述','幣別','金額','原始訊息','ID','轉帳ID'], rows);
}
const fakeSs = (sheets) => ({ getSheetByName: (n) => sheets[n] });
module.exports = { fakeSheet, fakeSheetWithHeader, fakeSs };
