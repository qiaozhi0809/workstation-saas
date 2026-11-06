# 教学工作台 部署与运维手册

本手册面向学校信息中心管理员,讲怎么在一台服务器上装起整套系统,以及日常的备份、恢复、升级与排障。所有命令都在**部署目录**(离线包解开后的目录)里执行,下文用 `./scripts/…` 表示。

> 本手册里的命令都以 `deploy/prod/scripts/` 里的脚本为准。带 `--help` 的脚本可以先看一眼用法。

## 目录

1. 硬件与系统要求
2. 拿到离线包后
3. 安装
4. HTTPS 三种方式
5. 反向代理与 `WS_TRUSTED_PROXIES`
6. 生产密钥
7. 备份
8. 恢复
9. 升级与降级
10. 诊断包
11. 账号安全运维(两步验证、登录日志、密码策略)
12. 常见故障

---

## 1. 硬件与系统要求

- 1 台 x86_64 服务器或工控机,2 核 4 GB 内存起步,磁盘建议 50-100 GB(安装时要求部署目录所在磁盘至少有 20 GB 可用)。
- 操作系统:**Ubuntu 22.04 LTS 或 24.04 LTS,x86_64**。v1 **不支持 Windows Server**(2026-11-05 用户定);其他 Linux 发行版不在支持范围内,`install.sh` 会拒绝(确需尝试可加 `--force`,后果自负)。
- 已安装 Docker Engine 与 `docker compose` 插件(离线机器请提前装好)。**`docker compose` 插件版本不低于 2.20**(用到 `up --pull never` 与 compose 文件顶层的 `name:`);`docker compose version --short` 可查看版本,低于 2.20 时 `install.sh`、`upgrade.sh`、`restore.sh` 会拒绝运行。运行脚本的用户要能使用 docker:要么是 root,要么在 `docker` 组里(`sudo usermod -aG docker $USER`,重新登录后生效)。
- 脚本依赖的命令:`bash`、`docker`、`docker compose`、`tar`、`gzip`、`sha256sum`、`openssl`、`awk`、`grep`、`sed`、`find`。Ubuntu 默认都有(`docker` 需自行安装)。
- 部署目录路径里**不能含空格,也不能含 `%`、`$`、`&`**(会让脚本与 systemd 定时备份出错)。建议放在 `/opt/workstation` 这类简单路径。
- 安装与升级全程**不需要外网**(只有证书方式选"公网域名自动申请"时才联网)。

### 离线安装 Docker(服务器不能上网时)

离线包里**不含 Docker 本身**。服务器不能联网时,先在一台能上网的电脑上把安装包下好,用 U 盘带过去。两种来源选一种;两种装出来的 `docker compose` 都是 v2 插件(老的 python 版 `docker-compose` v1 不行)。

**来源 A:Ubuntu 自带仓库(`docker.io` + `docker-compose-v2`)**——22.04 与 24.04 的仓库里都有这两个包(22.04 的 compose 是 2.20.x,刚好达到门槛;24.04 是 2.24 以上)。在一台**同版本(22.04 对 22.04、24.04 对 24.04)、刚装好系统、能联网**的 Ubuntu 上:

```bash
sudo apt-get update && sudo apt-get clean
sudo apt-get install -y --download-only docker.io docker-compose-v2
mkdir -p ~/docker-debs && cp /var/cache/apt/archives/*.deb ~/docker-debs/     # 把这一批 .deb 拷到 U 盘
```

到服务器上(全部 .deb 放在同一个目录):

```bash
cd /path/to/docker-debs && sudo dpkg -i ./*.deb      # dpkg 会自己排安装顺序
sudo systemctl enable --now docker
```

`dpkg -i` 报"依赖关系问题"说明两台机器的系统补丁级别不一样(服务器缺某个基础包):把报错里提到的包也在联网机器上 `apt-get download <包名>` 下回来一起装。

**来源 B:Docker 官方 .deb(`docker-ce`)**——在联网电脑上打开 `https://download.docker.com/linux/ubuntu/dists/<代号>/pool/stable/amd64/`(22.04 的代号是 `jammy`,24.04 是 `noble`),下载同一发布批次的五个文件:`containerd.io_*.deb`、`docker-ce_*.deb`、`docker-ce-cli_*.deb`、`docker-buildx-plugin_*.deb`、`docker-compose-plugin_*.deb`。到服务器上:

```bash
sudo dpkg -i ./containerd.io_*.deb ./docker-ce_*.deb ./docker-ce-cli_*.deb ./docker-buildx-plugin_*.deb ./docker-compose-plugin_*.deb
sudo systemctl enable --now docker
```

装完后核对(两种来源相同):

```bash
docker --version                   # 任意版本的 Docker Engine 均可
docker compose version --short     # 必须 ≥ 2.20,否则 install.sh / upgrade.sh / restore.sh 会拒绝运行
sudo docker info | grep -i 'docker root dir'   # Docker 数据目录所在盘要有足够空间(第 9 节"升级后的磁盘整理")
```

之后按第 3 节"用哪个用户执行脚本"决定是全程 root(sudo)还是把一个普通用户加进 `docker` 组。

## 2. 拿到离线包后

离线包的文件名是 `workstation-deploy-<版本>.tar.gz`,旁边应有校验文件 `workstation-deploy-<版本>.tar.gz.sha256`(`upgrade.sh` 也接受去掉 `.tar.gz` 的 `workstation-deploy-<版本>.sha256`,两个都有时用前者)。校验文件只取第一行的第一列(与 `sha256sum` 输出格式一致)。

1. 校验完整性:`sha256sum workstation-deploy-<版本>.tar.gz`,输出的第一列应与 `.sha256` 文件第一列一致。
2. 解开并进入目录:

   ```bash
   sudo mkdir -p /opt/workstation && sudo chown "$USER" /opt/workstation
   tar -xzf workstation-deploy-<版本>.tar.gz -C /opt/workstation --strip-components=1
   cd /opt/workstation
   ```

3. 目录里有:`VERSION`、`BUILD_INFO`(版本、构建所用的 git 提交号与时间,报障时请一并提供)、`docker-compose.yml`、`.env.example`、`Caddyfile.internal / .custom / .acme`、`images/workstation-images-<版本>.tar`、`scripts/`、`systemd/`、本手册。
4. 安装后会多出:`.env`(权限 600)、`Caddyfile`、`certs/`、`data/{pg,redis,caddy,logs}/`、`backups/`;每次升级后 `backups/` 里还会多一个 `pre-upgrade-<旧版本>-<时间>/` 快照目录(第 9 节)。

## 3. 安装

### 交互安装

```bash
./scripts/install.sh
```

依次询问:学校名称(1-50 字)、管理员登录名(默认 `admin`)、管理员密码(输入不显示,至少 8 位,字母、数字、其他字符至少含两类)、访问地址(域名或 IP)、证书方式(1/2/3,见第 4 节)。脚本会载入镜像、生成密钥、启动服务、初始化学校与管理员,最后打印访问地址。管理员**首次登录必须修改密码**。首个学年已自动创建(按安装当天推算),可在管理端「组织架构」→「学年」里修改名称和日期。

用 root 运行时会自动启用每日 02:30(学校时区)的 systemd 备份定时器;非 root 或没有 systemd 时,脚本会打印 crontab 行,请按第 7 节添加。

### 用哪个用户执行脚本(sudo 还是不 sudo,装好后不要换)

安装用的用户决定了 `.env`、`backups/` 等文件的属主;**之后的备份、恢复、升级、回退都必须用同一个用户**,否则会撞上另一个用户的 600 文件与锁目录。两种做法选一种:

- **推荐:全程 root**——`sudo ./scripts/install.sh`,以后所有脚本也都加 `sudo`(systemd 定时备份只有这种方式会自动启用)。
- **全程同一个普通用户**——该用户在 `docker` 组里,所有脚本都不加 `sudo`,自动备份走 crontab(第 7 节)。

`install.sh` 结尾会把该用哪个用户再提示一遍;用错用户时各脚本会直接报"该部署由 root 安装,请用 sudo 执行"或"该部署由用户 X 安装,请切换到该用户",而不是难懂的"另一个备份正在进行"(L183)。

### 非交互安装

```bash
WS_INSTALL_SCHOOL_NAME='示例学校' \
WS_INSTALL_ADMIN_LOGIN=admin \
WS_INSTALL_ADMIN_PASSWORD_FILE=/path/to/pw.txt \
WS_INSTALL_SITE=school.example.test \
WS_INSTALL_TLS=1 \
  ./scripts/install.sh --non-interactive
```

环境变量:

| 变量 | 说明 |
|---|---|
| `WS_INSTALL_SCHOOL_NAME` | 学校名称,必填 |
| `WS_INSTALL_ADMIN_LOGIN` | 管理员登录名,默认 `admin`(3-32 位字母、数字、`.` `_` `-`) |
| `WS_INSTALL_ADMIN_PASSWORD_FILE` | 存放管理员密码的文件,取第一行;**更稳妥**(环境变量会留在调用者的环境里)。**文件权限设为 600(`chmod 600`),装完后立即删除** |
| `WS_INSTALL_ADMIN_PASSWORD` | 管理员密码;与上一个二选一,必填其一 |
| `WS_INSTALL_SITE` | 访问地址(域名或 IP,只能含字母、数字、`.` `-` `_`),必填 |
| `WS_INSTALL_TLS` | 证书方式:`1`/`internal` 内部证书(默认)、`2`/`custom` 自备证书、`3`/`acme` 公网自动申请 |
| `WS_INSTALL_CERT`、`WS_INSTALL_KEY` | 自备证书与私钥的文件路径(PEM),`custom` 时必填 |
| `WS_INSTALL_ACME_EMAIL` | 申请证书的联系邮箱,`acme` 时必填 |
| `WS_HTTP_PORT`、`WS_HTTPS_PORT` | 对外端口,默认 80 / 443 |
| `WS_INSTALL_HEALTH_TIMEOUT` | 等应用就绪的秒数,默认 180;机器很慢时可调大 |

另有两个**只用于测试**的开关,正式离线包安装**不要设置**:`WS_INSTALL_SKIP_LOAD=1`(跳过载入镜像,假定镜像已在本机)与 `WS_INSTALL_MIN_DISK_GB`(下调磁盘空间门槛,默认 20)。

其他参数:`--force`(不是 Ubuntu 22.04 / 24.04 时仍继续)、`--help`。

### 重复运行与中断

- `.env` 一经存在就视为"已安装":再次运行 `install.sh` **不会**重新生成密钥,也不会建第二个学校,只确保服务已启动(并在学校尚未初始化时补做初始化)。
- 中途失败(如密码不合规、端口被占)后,改正原因直接重跑即可。
- 发现已有 `data/pg` 却没有 `.env` 时,脚本会拒绝继续,请从备份恢复 `.env`(见第 8 节)。

## 4. HTTPS 三种方式

浏览器与手机访问本系统必须走 HTTPS。三种方式在安装时选择,之后换方式需要改 `Caddyfile` 与 `.env` 里的 `WS_TLS_MODE`(建议联系技术支持)。

### 方式 1:内部证书(默认,离线可用)

系统用内置 CA 给你填的地址签发证书。**各终端必须先信任根证书,才能用域名访问**:

1. 安装完成后,根证书在 `certs/ws-root-ca.crt`(若安装时没取到,可手动导出:`docker compose exec -T web cat /data/caddy/pki/authorities/local/root.crt > certs/ws-root-ca.crt`)。
2. 把这个文件分发到所有终端(电脑、手机、平板),安装为"受信任的根证书"。常见做法:放在学校内网共享盘或用 U 盘;Windows 通过组策略或双击导入"受信任的根证书颁发机构";macOS 钥匙串里设为"始终信任";iOS / Android 在系统设置里安装证书并开启信任。
3. **先装根证书,再用域名访问。** 系统发出 HSTS 响应头,浏览器一旦访问过一次又不信任证书,就不会提供"继续访问"的按钮,只能清除该站点的 HSTS 记录(或装好根证书)后才能进入。
4. 根证书私钥在 `data/caddy/` 里,随备份保存;换服务器恢复时一并恢复,终端不需要重新安装根证书(见第 8 节)。

### 方式 2:学校自备证书

准备 PEM 格式的证书文件与私钥文件(证书需包含完整证书链,且覆盖你填写的访问地址)。安装时给出两个文件路径(`WS_INSTALL_CERT`、`WS_INSTALL_KEY`),脚本会校验证书并复制为:

- `certs/site.crt`(权限 644)
- `certs/site.key`(权限 600)

证书到期换新时,覆盖这两个文件(文件名不变),然后 `docker compose restart web`。

### 方式 3:公网域名自动申请

前提:服务器有**公网域名**并解析到本机,80 与 443 端口能从公网访问,服务器能联网;填一个联系邮箱(`WS_INSTALL_ACME_EMAIL`)。证书由 Caddy 自动向公共 CA 申请并续期。纯内网或无公网域名的学校请用方式 1 或 2。

## 5. 反向代理与 `WS_TRUSTED_PROXIES`

系统只在请求来自 `WS_TRUSTED_PROXIES`(`.env` 里,逗号分隔的 IP 或网段)时才采信 `X-Forwarded-For` 里的来源地址,用于登录日志与限流等。

- 它的值**必须包含 compose 内网的子网 `WS_SUBNET`**(`.env` 里相邻的一行)。`install.sh` 把两者写成同一个值:安装时依次检查 `172.30.0.0/24`、`172.31.0.0/24`、`10.250.0.0/24` 是否与本机路由(校园网、摄像头 VLAN、其他 Docker 网络)重叠,选第一个不重叠的;三个都重叠时停下,让你用环境变量 `WS_SUBNET=<网段>/24` 指定后重装。学校常把 172.16–31 用作校园网,所以**安装前先看一眼 `ip route`**,或直接指定一个不会用到的网段。
- 学校网络里**在本系统前面还有自己的代理**(如统一的 Nginx、负载均衡)时,把它的地址追加进去,例如 `WS_TRUSTED_PROXIES=172.30.0.0/24,10.0.0.5`,然后 `docker compose up -d` 使配置生效。不要删掉 `WS_SUBNET` 那一项。
- 装好之后要换子网:先 `docker compose down`(数据不受影响),再把 `.env` 里的 `WS_SUBNET` 与 `WS_TRUSTED_PROXIES` 改成新网段,然后重新运行 `./scripts/install.sh`。`install.sh` 会核对 `WS_TRUSTED_PROXIES` 包含 `WS_SUBNET`、以及已存在的网络子网与 `WS_SUBNET` 一致,不一致就拒绝启动并说明原因(L186 / L207)。
- 注意:**Docker 默认桥接网段 172.16.0.0/12 不在默认值内**。如果你自己改了 compose 的网络(用默认网络等),必须同步修改 `WS_TRUSTED_PROXIES`,否则 Caddy 到应用之间的来源地址不会被采信(L59)。
- 不要把不可信的网段填进来,否则任何人都能伪造来源地址。

## 6. 生产密钥

`install.sh` 自动生成并写入 `.env`(权限 600):`WS_JWT_SECRET`(令牌签名)、`WS_MASTER_KEY`(主密钥,加密 AI Key 等字段,将来也加密摄像头密码)、`POSTGRES_PASSWORD`、`WS_SCHOOL_ID`。管理员密码**不**写进 `.env`。

- **丢了 `.env` 等于丢了 AI Key 与摄像头密码**:数据库里的加密字段没有主密钥无法解开,且无法重新生成(L5)。
- `.env` 会随每份备份一起保存(备份包里的 `env`),所以备份必须和 `.env` 一样妥善保管。
- 不要把 `.env` 或备份发到外网、聊天群或工单里。
- 脚本不会把密钥打印到终端或日志里。

## 7. 备份

### 备份什么、放在哪

`./scripts/backup.sh` 生成 `backups/ws-backup-<YYYYMMDD-HHMMSS>-v<版本>.tar.gz`(权限 600),包内文件:

| 文件 | 内容 |
|---|---|
| `db.dump` | 数据库完整导出(`pg_dump -Fc`;导出后用 `pg_restore -l` 核对能读,读不出就不算备份成功) |
| `env` | `.env` 原样(**含主密钥**) |
| `caddy.tar` | Caddy 数据(证书、内部 CA 私钥),经 web 容器打出。web 没在运行时备份照做,只是没有这个文件,`manifest.json` 里记 `"caddy": "skipped"`,屏幕上会提示 |
| `config.tar` | 1.0.0 起:生效的 `Caddyfile`、`docker-compose.yml`、`VERSION` 与 `certs/` 下全部文件(**自备证书的私钥 `site.key` 在这里**) |
| `manifest.json` | 版本、迁移版本、创建时间、有没有 Caddy 数据,以及各文件的 sha256 |

**备份里含主密钥,必须放在学校自己的安全位置**(NAS、移动硬盘、保险柜里的存储),不要上传外网。建议把 `backups/` 里的文件定期复制到另一台设备,否则服务器硬盘坏了备份也一起丢。

### 手动备份

```bash
./scripts/backup.sh              # 默认保留最新 14 份(或环境变量 WS_BACKUP_KEEP)
./scripts/backup.sh --keep 30    # 保留最新 30 份
```

成功后还会更新 `data/logs/backup-last.json`,管理端设置页的"上次备份"读的就是它。备份、恢复、升级互斥(`backups/.lock`),同一时刻只能有一个在跑。

备份开始前检查磁盘:备份目录所在盘的可用空间要不少于**上次备份大小的 2 倍、且至少 1 GB**,否则直接拒绝(不会写到一半把盘撑满)。数据库容器还没就绪时(比如开机后定时器补跑)最多等 120 秒再开始,不会直接失败。

### 每日自动备份

- **root 安装**且系统有 systemd:`install.sh` 自动写入 `/etc/systemd/system/workstation-backup.service` 与 `.timer` 并启用,每天 **02:30(按 `.env` 里 `TZ` 的时区,默认 Asia/Shanghai)** 备份——服务器系统时区常是 UTC,定时器里写明时区才不会变成上午上课时备份;关机错过的那次开机后补跑(`Persistent=true`)。查看:`systemctl list-timers workstation-backup.timer`(`NEXT` 一列应是凌晨 02:30 本地时间);手动触发:`sudo systemctl start workstation-backup.service`;日志:`journalctl -u workstation-backup.service`。
- **非 root 安装**:`install.sh` 会打印 crontab 行,用 `crontab -e` 添加(路径换成你的部署目录)。日志交给 `logger`,由系统的 syslog / journal 轮转,不会无限增长;`CRON_TZ` 让 02:30 按学校时区计(服务器系统时区就是 Asia/Shanghai 时可省略):

  ```
  CRON_TZ=Asia/Shanghai
  30 2 * * * cd /opt/workstation && ./scripts/backup.sh 2>&1 | logger -t workstation-backup
  ```

  查看日志:`journalctl -t workstation-backup`(或 `grep workstation-backup /var/log/syslog`)。如果你一定要写到文件,请配 logrotate,例如 `/etc/logrotate.d/workstation-backup`:

  ```
  /opt/workstation/data/logs/backup.log {
      weekly
      rotate 8
      compress
      missingok
      notifempty
  }
  ```

- 不管哪种方式,请隔几天看一眼管理端设置页的"上次备份"时间,确认定时备份真的在跑。

### 统一用同一个用户执行备份

`backups/` 目录、备份文件、`data/logs/backup-last.json` 的属主是第一次执行备份的用户。**手动备份、crontab、systemd 请始终用同一个用户**(例如都用 root,或都用同一个普通用户),否则另一个用户会因权限不够写不了 `backup-last.json` 或读不了旧备份。

### `data/logs` 为什么是 1777

应用在容器里以 uid 10001 写日志,宿主机上执行备份的用户要写 `backup-last.json`,两者 uid 不同。`install.sh` 把 `data/logs` 设为 1777(所有人可写,加粘滞位:各用户只能删改自己的文件)。取舍:不依赖 `setfacl` / `chown`(在 NFS 等文件系统上不一定可用),也不需要 root;代价是服务器上其他登录用户也能往该目录写文件,请只给可信的人开服务器账号。日志文件本身已对密钥打码。

## 8. 恢复

```bash
./scripts/restore.sh backups/ws-backup-<时间>-v<版本>.tar.gz          # 交互,要求输入 yes
./scripts/restore.sh backups/ws-backup-<时间>-v<版本>.tar.gz --yes    # 非交互
```

### 流程

1. 先校验(不动数据库):归档完整、`manifest.json` 格式(1.0.0 之前的旧格式也认)、各文件 sha256、`env` 含必需键、大版本一致(0.7.x 的备份可以恢复进 1.x,应用启动时自动迁移)、备份的迁移版本不比当前镜像新、`db.dump` 能被 `pg_restore` 读出目录、磁盘空间够(恢复期间新旧两个库同时存在,要求可用空间不小于"当前数据库大小"与"备份里 db.dump 大小的 6 倍"中较大者的 1.2 倍)。任何一项不过都直接拒绝。
2. 先把备份恢复进临时库(此时系统仍在服务,正式库不受影响)。
3. 停止 app 与 scheduler,把正式库改名、临时库改名为正式库;成功后才删旧库。中途失败会自动还原,或明确提示"状态不确定、备份完好、重跑命令"。
4. 处理 `.env`、写回 Caddy 数据(备份里没有 Caddy 数据时跳过,保留当前机器的证书与内部 CA)、重启 web、清空 Redis(所有人需要重新登录)、启动服务并等应用就绪。

恢复会丢失备份之后产生的数据。备份里的 `config.tar`(Caddyfile、compose、VERSION、`certs/`)**不会自动应用**——它属于备份时那个版本的部署;需要时手动取:`tar -xOzf <备份>.tar.gz config.tar | tar -t`(看清单),`tar -xOzf <备份>.tar.gz config.tar | tar -x certs/site.key`(取自备证书私钥)。

### `.env` 丢了怎么办

`.env` 里的主密钥不可再生(第 6 节),丢了只能从备份里取回:

```bash
tar -xOzf backups/ws-backup-<时间>-v<版本>.tar.gz env > .env && chmod 600 .env
```

然后 `./scripts/install.sh` 让服务按它启动(`.env` 存在就不会重新生成密钥)。注意取回的是**备份时刻**的 `.env`:之后改过的站点地址、端口、`WS_STREAM_*` 等要重新核对。没有任何一份备份时,数据库里用主密钥加密的字段(AI Key、摄像头密码)无法解开,只能重新填写;令牌密钥、学校 ID 可以从头生成(删掉 `data/pg` 重装等于全新系统,所有数据丢失)——这就是为什么备份必须离机保存。

### 与当前 `.env` 的取舍

- **取备份里的**(与数据绑定):`WS_MASTER_KEY`、`WS_JWT_SECRET`、`WS_SCHOOL_ID`。
- **保持当前机器的**(部署环境属性):`POSTGRES_PASSWORD` 与 `WS_DATABASE_URL`(数据库角色密码是装机时定的,不随恢复改变)、`WS_VERSION`、`WS_REDIS_URL`、`WS_ENV`、`WS_TRUSTED_PROXIES`、站点地址、端口、证书方式、ACME 邮箱。备份里有而当前没有的键会追加。
- 如果结果与当前 `.env` 不同,恢复前的 `.env` 另存为 `.env.before-restore-<时间>`(权限 600),请核对后删除。

### 恢复到新机器(灾备)

1. 新机器按第 1 节准备好 Ubuntu 与 Docker,解开**与备份同大版本**的离线包(版本最好与备份的版本一致)。
2. 把备份文件复制到新机器(例如放进部署目录的 `backups/`)。
3. 执行 `./scripts/install.sh`(交互或非交互)装出一套全新系统,学校名、管理员随意填(之后会被备份覆盖)。**站点地址、端口、证书方式用新机器要用的值**——它们不会从备份恢复。自备证书方式的证书与私钥可以从备份的 `config.tar` 里取(上文),安装时用 `WS_INSTALL_CERT` / `WS_INSTALL_KEY` 指向它们。
4. 执行 `./scripts/restore.sh <备份文件> --yes`。
5. 内部证书方式:Caddy 数据(含内部 CA 的根证书与私钥)已随备份恢复,新机器用的还是旧机器的根证书。即使新机器的访问地址变了,新地址的证书也由**同一个根证书**签发,所以各终端**不需要重新安装根证书**(第 4 节方式 1 第 4 点)。
6. 用管理员账号(备份里的,不是第 3 步填的)登录,检查数据。

## 9. 升级与降级

### 升级

```bash
./scripts/upgrade.sh /path/to/workstation-deploy-<新版本>.tar.gz
```

脚本依次:校验离线包(有 `.sha256` 时核对,命名见第 2 节)→ **强制备份**(失败就停)→ 载入新镜像 → 用新镜像对现有数据库做**迁移预检** → **保存升级前快照**(见下)→ 覆盖程序文件(不动 `.env`、`certs/`、`data/`、`backups/`)→ 重启并确认 app 健康、scheduler 在运行、web 健康(缺一都按失败处理,并打印回退办法)。新版本 `.env.example` 里新增的配置项会按默认值追加进 `.env` 并提示,请核对。`./scripts/upgrade.sh --help` 可看用法。

- 迁移预检不通过时(退出码 2):在覆盖任何文件、动任何服务之前就停下,系统仍运行在旧版本,屏幕上有报告与定位 SQL,按报告处理数据后重试。
- 大版本不同(如 1.x → 2.x)与低于当前版本的离线包都会被拒绝;唯一放行的大版本跳跃是 0.7.x → 1.x(见下文"从 0.7.2 升级到 1.0.0")。
- 升级会重启服务,请在课后或夜间进行。
- **执行升级的始终是已装版本的脚本**(新包里的脚本要到下一次升级才用上)。所以本节描述的快照、回退、中断处置,只对**从 1.0.0 及更新版本出发**的升级成立;从 0.7.2 出发的那一次见本节末尾。

### 升级前快照(1.0.0 起)

覆盖程序文件之前,`upgrade.sh` 把当时在用的 `docker-compose.yml`、`Caddyfile`(含三份模板)、`VERSION`、`BUILD_INFO`、`.env.example`、`README.md`、`scripts/`、`systemd/` 原样复制到 `backups/pre-upgrade-<旧版本>-<时间>/`(权限 700),并在 `backups/.ws-upgrade-state` 记下"升级进行中"(旧版、新版、快照目录、升级前备份)。升级成功后状态文件删除,快照目录保留;确认新版本运行稳定后可以手动删掉旧快照(每个只有几百 KB)。`.env` 不进快照(有密钥),升级前的备份包里已有一份。

### 失败后回退(1.0.0 起)

不支持用离线包直接降级(数据库可能已迁移到更新的结构)。覆盖文件之后升级失败,脚本会打印回退办法,照着做:

1. `./scripts/rollback.sh backups/pre-upgrade-<旧版本>-<时间>`(不带参数时用状态文件里记录的快照):把快照里的程序文件复制回部署目录、把 `.env` 的 `WS_VERSION` 改回旧版本号(旧版本的镜像升级时没有删),然后比对数据库的迁移版本与旧版镜像:
   - **数据库没被新版本改动**(多数失败是新版本起不来)→ 直接用旧版镜像重启全部服务、确认健康,回退完成(退出码 0)。
   - **数据库已被新版本迁移** → 停掉应用容器,提示下一步(退出码 3)。
2. 只有上一步提示了才需要:`./scripts/restore.sh backups/<升级前备份>.tar.gz`(升级输出里有文件名),用升级前自动做的那份备份把数据库恢复回去。会丢失升级开始之后产生的数据。

`rollback.sh` 不会删除快照与备份。回退之后系统回到旧版本;修好原因(通常是新包或服务器的问题,把 `docker compose logs app` 发给技术支持)后可以再次升级。

### 升级中断(断电、强制结束)后怎么办(1.0.0 起)

升级在覆盖文件之后被断电、`kill -9` 打断时,脚本来不及打印任何提示,但 `backups/.ws-upgrade-state` 会留下来。之后不管运行 `upgrade.sh` 还是 `rollback.sh`,都会先说明"上次升级(旧版 → 新版,开始时间)没有确认成功",然后二选一:

- `./scripts/rollback.sh`(不带参数)回到旧版本;或
- 重新运行**同一个**离线包的 `./scripts/upgrade.sh`,脚本按重跑处理(回退时仍以中断那次的快照为准),完成后状态文件清除。

换一个版本不同的离线包升级会被拒绝,直到按上面两种办法之一处理完。中断留下的解包临时目录(`.ws-upgrade.*`)由下一次运行的脚本自动清理。

### 升级后的磁盘整理

旧版本的三个镜像(`workstation-app / workstation-web / workstation-stream:<旧版本>`)升级时**不会删除**,回退要用。确认新版本运行一两周没有问题后,可以释放它们占的空间(每个版本约 1 GB):

```bash
docker image rm workstation-app:<旧版本> workstation-web:<旧版本> workstation-stream:<旧版本>
```

升级成功时脚本会把这条命令连同旧版本号一起打印出来。`install.sh` / `upgrade.sh` 的磁盘空间检查同时看部署目录所在盘与 Docker 数据目录(`docker info` 里的 `Docker Root Dir`,通常是 `/var/lib/docker`)所在盘,两者都要有 20 GB 可用。

### 从 0.7.2 升级到 1.0.0

0.7.2 的 `upgrade.sh` 还不会保存快照、也拒绝 0.x → 1.x 的大版本跳跃。这一跳请先把新包的脚本覆盖进部署目录,再用新脚本升级(在部署目录里执行;`<新包>` 换成实际路径):

```bash
tar -xzf <新包>/workstation-deploy-1.0.0.tar.gz -C . --strip-components=1 workstation-deploy-1.0.0/scripts
./scripts/upgrade.sh <新包>/workstation-deploy-1.0.0.tar.gz
```

之后就是 1.0.0 的脚本在执行:会保存快照、写状态文件,失败与中断的处置按上面几小节来(回退用 `./scripts/rollback.sh`,它会把 0.7.2 的 `docker-compose.yml` 与 `VERSION` 复制回来并起 0.7.2 的镜像;`scripts/` 保持 1.0.0 的,它们同样能管理 0.7.2 的部署,也能恢复 0.7.2 的备份)。`.env` 会多出 `WS_SUBNET`(取自当前网络的子网 `172.30.0.0/24`)。

如果没有做这一步、直接用 0.7.2 的脚本升级,它会报"大版本升级需要专门的迁移说明"而停下,系统仍在 0.7.2,没有任何改动。

## 10. 诊断包

遇到问题需要技术支持时,有两种诊断包,**都不含业务数据与 `.env`**:

- **网页导出**:管理员(信息中心、校长等有"系统设置"权限的账号)在管理端设置页的"系统"卡片点"导出诊断信息",得到 zip(版本、打码后的配置、数据库结构、各表行数、最近 3 天应用日志)。
- **主机诊断**:在服务器上执行

  ```bash
  ./scripts/diagnose.sh                # 当前目录生成 ws-host-diagnostics-<时间>.tar.gz
  ./scripts/diagnose.sh --out /tmp     # 指定输出目录
  ```

  内含 `docker compose ps`、`docker version`、`df -h`、`free -m`、`uname -a` 与各服务最近 24 小时日志。

两种都已对密钥、数据库密码、令牌、手机号打码,但打码只覆盖**已知模式**。**发给外部之前,请自己打开看一遍**:应用日志里的异常堆栈、上游服务的错误响应体仍可能含业务数据。

1.0.0 起 `data/logs/app.jsonl` 里也包含 web 服务器(uvicorn)的访问日志与各第三方库的日志(每行一条 JSON,`logger` 字段标明来源),不再只有应用自己的事件;播放片段地址里的 `u=`、`sig=`、`token=` 参数在写入时就已打码(L111 / L158)。`docker compose logs app` 看到的是同样的内容。

## 11. 账号安全运维(两步验证、登录日志、密码策略)

0.7.1 起提供下面三项,都在管理端操作,升级时迁移会自动完成(见第 9 节),**没有新增必填配置**。

### 两步验证(TOTP)

- 默认关闭。信息中心或校长在管理端「学校设置 → 账号安全」打开"允许账号开启两步验证"并保存;之后每个账号(老师、管理者、家长)可在头像菜单「账号安全」里自行开启:用验证器应用扫二维码(或手输密钥),输一次 6 位验证码并**再输一次当前密码**确认。关闭同样要输当前密码。
- 开启后登录分两步:密码对了才出现"两步验证"页,输 6 位码。同一个码只能用一次;码前后各容忍 30 秒,所以服务器和手机的时间要大致准确。验证码连错、密码连错共用登录失败计数,超限锁定 15 分钟。
- 关掉学校开关不影响已开启的账号:他们仍要输码登录,也仍可自行关闭。
- **丢了手机怎么办**:没有恢复码。让有"账号管理"权限的人(信息中心、校长)在管理端「账号」页找到该账号,点「重置两步验证」(不能重置自己)。重置后该账号下次登录只要密码,之后可以自行重新开启。重置会写审计日志(`account.totp_reset`)。
- 管理员账号本人丢了手机、又没有第二个有权限的人时:在服务器上用备份还原到开启之前的状态,或联系技术支持;请至少保证有两个能重置他人两步验证的账号。

### 登录日志

- 管理端「系统 → 登录日志」(需要审计查看权限:信息中心、校长)按时间、登录名 / 姓名、结果(成功 / 密码错误 / 账号不存在 / 账号已停用 / 已锁定 / 验证码错误)、是否可疑筛选,可导出 CSV(时间为学校本地时区,导出本身写审计日志 `account.login_logs_export`)。
- 凌晨 0–5 点(学校时区)登录,或从该账号 90 天内没用过的网段登录(且已有至少 3 次成功登录),会标"可疑",并给本人和信息中心各发一条"账号安全提醒"系统通知。
- **保留天数**:在 `.env` 里加一行 `WS_LOGIN_LOG_DAYS=<天数>`(`.env.example` 里没有,默认 180),允许 30–730;`scheduler` 每天清理超期的行。修改后执行 `docker compose up -d` 让 app 与 scheduler 重新读取。登录日志不含密码、验证码和令牌。
- 登录日志里的来源地址取自反向代理传来的地址,依赖第 5 节的 `WS_TRUSTED_PROXIES` 配对正确。

### 密码长度与有效期

- 「学校设置 → 账号安全」可设密码最短长度(8–32,默认 8,仍要求字母、数字、符号至少两类)和有效期(不限 / 90 / 180 / 365 天,默认不限)。调大最短长度不影响已有密码,下次修改时生效。
- 设了有效期后,超期账号登录会先被带到改密码页并提示"密码已超过 N 天未更换",改完才能用业务功能。
- 本人改密码、管理员重置密码后,**其他已打开的页面不刷新就会回到登录页**(本人当前这一页不掉线);改 / 重置 / 开启两步验证之前签发的访问令牌立即失效。

## 12. 常见故障

| 现象 | 原因与处理 |
|---|---|
| 安装提示"端口 N 已被占用" | 先停掉占用 80 / 443 的程序(如已有的 Nginx / Apache),或用 `WS_HTTP_PORT`、`WS_HTTPS_PORT` 换端口后重装。用 `ss -ltnp` 查占用者。 |
| 浏览器提示"不安全"、无法继续访问 | 内部证书方式下该终端还没信任根证书(见第 4 节方式 1)。HSTS 会让浏览器不给"继续访问"按钮,必须先装根证书。自备证书则检查证书是否覆盖访问地址、是否过期、证书链是否完整。 |
| 自定义了 HTTPS 端口后,访问 `http://…` 跳到了打不开的地址 | HTTP 到 HTTPS 的自动跳转固定指向标准 443 端口。端口不是 443 时,请直接访问 `https://主机:HTTPS端口`,并让用户收藏这个地址。 |
| 安装或升级提示"可用空间不足" | 部署目录所在磁盘空间不够(安装门槛 20 GB)。清理磁盘或把部署目录迁到大盘;备份也很占空间,可调小 `--keep`、把旧备份挪到别的设备。 |
| 磁盘满了系统异常 | 先 `df -h` 与 `du -sh data/* backups` 找大头;清理旧备份与旧日志后 `docker compose restart`。 |
| 升级报"迁移预检不通过"(退出码 2) | 现有数据不满足新版本的约束(如登录名大小写重复、座位行列数越界)。系统仍在旧版本运行。按报告里的"定位"SQL 找到数据、改正后重新运行升级。 |
| 提示"另一个备份、恢复或升级正在进行" | 有另一个脚本在跑(`install.sh` 也会加同一把锁),等它结束;确认没有在跑时删除报告里的 `backups/.lock` 目录。 |
| 提示"该部署由 root 安装,请用 sudo 执行"或"该部署由用户 X 安装,请切换到该用户" | 用错了用户。按第 3 节"用哪个用户执行脚本",改用安装时那个用户(root 就加 `sudo`,普通用户就不加)再跑。 |
| 升级提示"上次升级(… → …)在覆盖程序文件之后中断,没有确认成功" | 上次升级被断电或强制结束。按第 9 节"升级中断":`./scripts/rollback.sh` 回到旧版,或重跑同一个离线包。 |
| 升级失败,屏幕上出现"回到旧版本 … 的办法" | 照着执行:先 `./scripts/rollback.sh <快照目录>`,它提示数据库已被迁移时再 `./scripts/restore.sh <升级前备份>`(第 9 节)。 |
| 备份提示"web 服务没有在运行,本次备份不含 Caddy 数据" | 备份已成功,只是没带证书与内部 CA 私钥。`docker compose up -d web` 后再备份一次即可得到完整备份。 |
| 安装或升级提示"Docker 数据目录 … 所在磁盘可用空间不足" | 镜像与容器日志所在的盘(通常是 `/var/lib/docker` 所在的系统盘)不够 20 GB。删除旧版本镜像(第 9 节"升级后的磁盘整理")或扩容。 |
| 安装提示"候选子网(…)都与本机网段重叠" | 校园网把 172.30 / 172.31 / 10.250 都用了。看 `ip route`,挑一个没用的网段:`WS_SUBNET=10.251.0.0/24 ./scripts/install.sh …`(第 5 节)。 |
| 提示"WS_TRUSTED_PROXIES(…)不包含 compose 子网"或"ws-net 现在的子网是 … 而 .env 的 WS_SUBNET 是 …" | `.env` 里两个网段键改得不一致,或改了 `WS_SUBNET` 没有 `docker compose down`。按第 5 节改正。 |
| 备份提示写 `backup-last.json` 失败 | 该文件被另一个用户先建成了只读。统一用同一个用户备份(第 7 节);或用原来的用户删除该文件后重做。 |
| 安装提示部署目录含空格或 `% $ &` | 把部署目录移到不含这些字符的路径(如 `/opt/workstation`)再安装。 |
| 应用没起来 | `docker compose logs app`(在部署目录里执行,若用了自定义项目名需加 `-p`)查看原因,必要时按第 10 节导出诊断包。 |
