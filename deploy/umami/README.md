# Umami v2.4.1 自托管部署包（醉里博客）

在本目录（VPS 上）执行：

```bash
cp .env.example .env        # 已附带生成好的 .env 也可直接用
docker compose pull         # ghcr 慢时见 docker-compose.yml 头部镜像替换方案
docker compose up -d
docker compose logs -f umami   # 看到 "Listening on http://127.0.0.1:3000" 即成功
```

## 1. 初始化

1. 浏览器打开 `http://127.0.0.1:3000`（或先配好 Nginx 用域名访问）
2. 登录：`admin / umami` → **立即修改密码**（Settings → Account）
3. **Add website**：
   - Name：`醉里博客`
   - Domain：`202271.xyz`
4. 记录该网站的 **Website ID**（设置页可复制）

## 2. Nginx 反代 + HTTPS

DNS 添加 A 记录：`analytics.202271.xyz → VPS IP`，然后：

```bash
sudo cp nginx-umami.conf.sample /etc/nginx/conf.d/umami.conf
# 首次签证书：先注释 conf 中 443 server 的 ssl 两行，certbot 通过后恢复
sudo certbot --nginx -d analytics.202271.xyz
sudo nginx -t && sudo nginx -s reload
```

验证：`https://analytics.202271.xyz` 能打开 Umami 登录页。

## 3. 生成博客要用的 Token

```bash
curl -s -X POST https://analytics.202271.xyz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"你的新密码"}'
# 返回 {"token":"eyJhbGci...","user":{...}} —— 复制 token
```

> Token 为 JWT 签名（APP_SECRET 签发）。若日后失效（改密/换 SECRET），重新执行上述命令即可。

## 4. 数据备份与升级

```bash
# 备份（建议 crontab 每日）
docker exec umami-db pg_dump -U umami umami | gzip > ~/umami-$(date +%F).sql.gz

# 升级版本：改 compose 中的 TAG → pull && up -d
```

## 5. 常见问题

- **ghcr 拉取超时**：见 compose 头部注释的镜像替换方案；或任意外网机器
  `docker pull … && docker save … | ssh user@vps docker load`
- **端口占用**：compose 只绑定 127.0.0.1:3000，对外全部走 Nginx 443
- **共享访问**：Umami 还支持给单站点生成公开分享页（网站设置 → Share URL），
  可作为公开的数据看板链接放导航
