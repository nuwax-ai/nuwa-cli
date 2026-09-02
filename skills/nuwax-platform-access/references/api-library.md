# 资料库 API 速查（前缀 `/api/v1/4sandbox/repo`）

> 13 端点一览与精确请求/响应体、ops 指令细节，**以 `library-document-management` 的
> `references/api.md` / `ops-doc.md` / `ops-sheet.md` / `ops-pptx.md` 为权威**，此处只列接入要用的最小集。

## 端点速查

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/spaces` | 空间列表（`type:"Personal"` 是个人空间，新建文档默认 spaceId） |
| GET | `/spaces/{spaceId}/tree` | 空间页面树 |
| GET | `/pages/{pageId}` | 页面元数据（`pageType`/`sourceExt`） |
| GET | `/pages/by-slug/{slugId}` | 按短链读页面 |
| GET | `/pages/{pageId}/content` | 读正文 |
| GET | `/pages/{pageId}/export?format=` | 导出 markdown/docx/pdf/xlsx/pptx/original（全实时） |
| GET | `/search?spaceId=&keyword=` | 搜索 |
| POST | `/pages` | 新建页面（**仅元数据，读回是空的**） |
| POST | `/pages/{pageId}/rename` | 重命名 |
| POST | `/pages/{pageId}/delete` | 软删（不可恢复） |
| POST | `/pages/{pageId}/content` | ops 指令改正文 |
| POST | `/import` | **导入（建页+解析+播种快照，一步到位）** |

## /import 最小接入

```bash
curl -s -X POST "$BASE/api/v1/4sandbox/repo/import" \
  -H "Authorization: Bearer $SANDBOX_ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"spaceId":57,"fileName":"报告.md","text":"# 标题\n\n正文..."}'
# → data: {"ok":true,"pageId":201,"slugId":"xxx","pageType":"doc","sourceExt":"md","parsed":true}
```

字段语义（记住三条就够）：

1. **文本类（md/txt/html/csv）走 `text`**——无需上传、无需 content。
2. **二进制原件（pptx/docx/xlsx/pdf）深度解析靠 `content`（base64 字节）**；`fileKey`（`POST /api/v1/4sandbox/file/upload` 返回的 `data.key`）只做原件永存。只传 fileKey = `parsed:false` 占位页。
3. `ticket` 由服务端自动生成，不用管。

## 错误码

`"0000"` 成功；`"0001"` 业务错误（看 message）；`"4030"` 缺 Bearer；`"4000"` 参数/凭据无效；`"4040"` 路径不存在。HTTP 状态码恒 200 居多，**永远看 code**。
