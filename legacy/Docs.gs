function getSystemDocument(sessionToken, documentType) {
  requireAdminSession_(sessionToken);
  const key=String(documentType||'').toLowerCase();
  if(!['requirements','technical'].includes(key))throw new Error('文書種別を確認してください。');
  const doc=GENERATED_DOCS[key];
  if(!doc)throw new Error('設計文書が生成されていません。');
  return {
    type:key,
    title:doc.title,
    version:doc.version,
    updatedAt:doc.updatedAt,
    markdown:doc.markdown
  };
}
