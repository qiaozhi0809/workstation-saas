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
11. 常见故障

---

## 1. 硬件与系统要求

- 1 台 x86_64 服务器或工控机,2 核 4 GB 内存起步,磁盘建议 50-100 GB(安装时要求部署目录所在磁盘至少有 20 GB 可用)。
- 操作系统:**Ubuntu 22.04 LTS 或 24.04 LTS,x86_64**。v1 **不支持 Windows Server**(2026-11-05 用户定);其他 Linux 发行版不在支持范围内,`install.sh` 会拒绝(确需尝试可加 `--force`,后果自负)。
- 已安装 Docker Engine 与 `docker compose` 插件(离线机器请提前装好)。**`docker compose` 插件版本不低于 2.20**(用到 `up --pull never` 与 compose 文件顶层的 `name:`);`docker compose version --short` 可查看版本,低于 2.20 时 `install.sh`、`upgrade.sh`、`restore.sh` 会拒绝运行。运行脚本的用户要能使用 docker:要么是 root,要么在 `docker` 组里(`sudo usermod -aG docker $USER`,重新登录后生效)。
- 脚本依赖的命令:`bash`、`docker`、`docker compose`、`tar`、`gzip`、`sha256sum`、`openssl`、`awk`、`grep`、`sed`、`find`。Ubuntu 默认都有(`docker` 需自行安装)。
- 部署目录路径里**不能含空格,也不能含 `%`、`$`、`&`**(会让脚本与 systemd 定时备份出错)。建议放在 `/opt/workstation` 这类简单路径。
- 安装与升级全程**不需要外网**(只有证书方式选"公网域名自动申请"时才联网)。

## 2. 拿到离线包后

离线包的文件名是 `workstation-deploy-<版本>.tar.gz`,旁边应有校验文件 `workstation-deploy-<版本>.tar.gz.sha256`(`upgrade.sh` 也接受去掉 `.tar.gz` 的 `workstation-deploy-<版本>.sha256`,两个都有时用前者)。校验文件只取第一行的第一列(与 `sha256sum` 输出格式一致)。

1. 校验完整性:`sha256sum workstation-deploy-<版本>.tar.gz`,输出的第一列应与 `.sha256` 文件第一列一致。
2. 解开并进入目录:

   ```bash
   sudo mkdir -p /opt/workstation && sudo chown "$USER" /opt/workstation
   tar -xzf workstation-deploy-<版本>.tar.gz -C /opt/workstation --strip-components=1
   cd /opt/workstation
   ```

3. 目录里有:`VERSION`、`docker-compose.yml`、`.env.example`、`Caddyfile.internal / .custom / .acme`、`images/workstation-images-<版本>.tar`、`scripts/`、`systemd/`、本手册。
4. 安装后会多出:`.env`(权限 600)、`Caddyfile`、`certs/`、`data/{pg,redis,caddy,logs}/`、`backups/`。

## 3. 安装

### 交互安装

```bash
./scripts/install.sh
```

依次询问:学校名称(1-50 字)、管理员登录名(默认 `admin`)、管理员密码(输入不显示,至少 8 位,字母、数字、其他字符至少含两类)、访问地址(域名或 IP)、证书方式(1/2/3,见第 4 节)。脚本会载入镜像、生成密钥、启动服务、初始化学校与管理员,最后打印访问地址。管理员**首次登录必须修改密码**。

用 root 运行时会自动启用每日 02:30 的 systemd 备份定时器;非 root 或没有 systemd 时,脚本会打印一行 crontab,请按第 7 节添加。

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

- 默认值 `172.30.0.0/24` 是本部署 compose 内网的固定子网(`docker-compose.yml` 里 `ws-net`)。
- 学校网络里**在本系统前面还有自己的代理**(如统一的 Nginx、负载均衡)时,把它的地址加进去,例如 `WS_TRUSTED_PROXIES=172.30.0.0/24,10.0.0.5`,然后 `docker compose up -d` 使配置生效。
- 注意:**Docker 默认桥接网段 172.16.0.0/12 不在默认值内**。如果你自己改了 compose 的网络(换子网、用默认网络等),必须同步修改 `WS_TRUSTED_PROXIES`,否则 Caddy 到应用之间的来源地址不会被采信(L59)。
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
| `db.dump` | 数据库完整导出(`pg_dump -Fc`) |
| `env` | `.env` 原样(**含主密钥**) |
| `caddy.tar` | Caddy 数据(证书、内部 CA 私钥),经 web 容器打出 |
| `manifest.json` | 版本、迁移版本、创建时间与各文件的 sha256 |

**备份里含主密钥,必须放在学校自己的安全位置**(NAS、移动硬盘、保险柜里的存储),不要上传外网。建议把 `backups/` 里的文件定期复制到另一台设备,否则服务器硬盘坏了备份也一起丢。

### 手动备份

```bash
./scripts/backup.sh              # 默认保留最新 14 份(或环境变量 WS_BACKUP_KEEP)
./scripts/backup.sh --keep 30    # 保留最新 30 份
```

成功后还会更新 `data/logs/backup-last.json`,管理端设置页的"上次备份"读的就是它。备份、恢复、升级互斥(`backups/.lock`),同一时刻只能有一个在跑。

### 每日自动备份

- **root 安装**且系统有 systemd:`install.sh` 自动写入 `/etc/systemd/system/workstation-backup.service` 与 `.timer` 并启用,每天 02:30 备份。查看:`systemctl list-timers workstation-backup.timer`;手动触发:`sudo systemctl start workstation-backup.service`;日志:`journalctl -u workstation-backup.service`。
- **非 root 安装**:`install.sh` 会打印一行 crontab,用 `crontab -e` 添加(路径换成你的部署目录):

  ```
  30 2 * * * cd /opt/workstation && ./scripts/backup.sh >> data/logs/backup.log 2>&1
  ```

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

1. 先校验(不动数据库):归档完整、`manifest.json` 格式、各文件 sha256、`env` 含必需键、大版本一致、备份的迁移版本不比当前镜像新、磁盘空间够(恢复期间新旧两个库同时存在,要求可用空间不小于"当前数据库大小"与"备份里 db.dump 大小的 6 倍"中较大者的 1.2 倍)。任何一项不过都直接拒绝。
2. 先把备份恢复进临时库(此时系统仍在服务,正式库不受影响)。
3. 停止 app 与 scheduler,把正式库改名、临时库改名为正式库;成功后才删旧库。中途失败会自动还原,或明确提示"状态不确定、备份完好、重跑命令"。
4. 处理 `.env`、写回 Caddy 数据、重启 web、清空 Redis(所有人需要重新登录)、启动服务并等应用就绪。

恢复会丢失备份之后产生的数据。

### 与当前 `.env` 的取舍

- **取备份里的**(与数据绑定):`WS_MASTER_KEY`、`WS_JWT_SECRET`、`WS_SCHOOL_ID`。
- **保持当前机器的**(部署环境属性):`POSTGRES_PASSWORD` 与 `WS_DATABASE_URL`(数据库角色密码是装机时定的,不随恢复改变)、`WS_VERSION`、`WS_REDIS_URL`、`WS_ENV`、`WS_TRUSTED_PROXIES`、站点地址、端口、证书方式、ACME 邮箱。备份里有而当前没有的键会追加。
- 如果结果与当前 `.env` 不同,恢复前的 `.env` 另存为 `.env.before-restore-<时间>`(权限 600),请核对后删除。

### 恢复到新机器(灾备)

1. 新机器按第 1 节准备好 Ubuntu 与 Docker,解开**与备份同大版本**的离线包(版本最好与备份的版本一致)。
2. 把备份文件复制到新机器(例如放进部署目录的 `backups/`)。
3. 执行 `./scripts/install.sh`(交互或非交互)装出一套全新系统,学校名、管理员随意填(之后会被备份覆盖)。**站点地址、端口、证书方式用新机器要用的值**——它们不会从备份恢复。
4. 执行 `./scripts/restore.sh <备份文件> --yes`。
5. 内部证书方式:Caddy 数据(含内部 CA 的根证书与私钥)已随备份恢复,新机器用的还是旧机器的根证书。即使新机器的访问地址变了,新地址的证书也由**同一个根证书**签发,所以各终端**不需要重新安装根证书**(第 4 节方式 1 第 4 点)。
6. 用管理员账号(备份里的,不是第 3 步填的)登录,检查数据。

## 9. 升级与降级

### 升级

```bash
./scripts/upgrade.sh /path/to/workstation-deploy-<新版本>.tar.gz
```

脚本依次:校验离线包(有 `.sha256` 时核对,命名见第 2 节)→ **强制备份**(失败就停)→ 载入新镜像 → 用新镜像对现有数据库做**迁移预检** → 覆盖程序文件(不动 `.env`、`Caddyfile`、`certs/`、`data/`、`backups/`)→ 重启并确认 app 健康、scheduler 在运行、web 健康(缺一都按失败处理,并打印回退办法)。新版本 `.env.example` 里新增的配置项会按默认值追加进 `.env` 并提示,请核对。

- 迁移预检不通过时(退出码 2):在覆盖任何文件、动任何服务之前就停下,系统仍运行在旧版本,屏幕上有报告与定位 SQL,按报告处理数据后重试。
- 大版本不同(如 1.x → 2.x)与低于当前版本的离线包都会被拒绝。
- 升级会重启服务,请在课后或夜间进行。

### 降级与失败后手动回退

不支持用离线包直接降级(数据库可能已迁移到更新的结构)。覆盖文件之后升级失败,脚本会打印回退办法,按顺序:

1. 先把 `.env` 里的 `WS_VERSION` 改回旧版本号(旧版本的镜像不会被删除)。
2. 再用升级前自动做的那份备份恢复:`./scripts/restore.sh backups/<升级前备份>.tar.gz`。

顺序不能反:恢复脚本用 `.env` 里的 `WS_VERSION` 对应的镜像来检查与启动。

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

## 11. 常见故障

| 现象 | 原因与处理 |
|---|---|
| 安装提示"端口 N 已被占用" | 先停掉占用 80 / 443 的程序(如已有的 Nginx / Apache),或用 `WS_HTTP_PORT`、`WS_HTTPS_PORT` 换端口后重装。用 `ss -ltnp` 查占用者。 |
| 浏览器提示"不安全"、无法继续访问 | 内部证书方式下该终端还没信任根证书(见第 4 节方式 1)。HSTS 会让浏览器不给"继续访问"按钮,必须先装根证书。自备证书则检查证书是否覆盖访问地址、是否过期、证书链是否完整。 |
| 自定义了 HTTPS 端口后,访问 `http://…` 跳到了打不开的地址 | HTTP 到 HTTPS 的自动跳转固定指向标准 443 端口。端口不是 443 时,请直接访问 `https://主机:HTTPS端口`,并让用户收藏这个地址。 |
| 安装或升级提示"可用空间不足" | 部署目录所在磁盘空间不够(安装门槛 20 GB)。清理磁盘或把部署目录迁到大盘;备份也很占空间,可调小 `--keep`、把旧备份挪到别的设备。 |
| 磁盘满了系统异常 | 先 `df -h` 与 `du -sh data/* backups` 找大头;清理旧备份与旧日志后 `docker compose restart`。 |
| 升级报"迁移预检不通过"(退出码 2) | 现有数据不满足新版本的约束(如登录名大小写重复、座位行列数越界)。系统仍在旧版本运行。按报告里的"定位"SQL 找到数据、改正后重新运行升级。 |
| 提示"另一个备份、恢复或升级正在进行" | 有另一个脚本在跑,等它结束;确认没有在跑时删除报告里的 `backups/.lock` 目录。 |
| 备份提示写 `backup-last.json` 失败 | 该文件被另一个用户先建成了只读。统一用同一个用户备份(第 7 节);或用原来的用户删除该文件后重做。 |
| 安装提示部署目录含空格或 `% $ &` | 把部署目录移到不含这些字符的路径(如 `/opt/workstation`)再安装。 |
| 应用没起来 | `docker compose logs app`(在部署目录里执行,若用了自定义项目名需加 `-p`)查看原因,必要时按第 10 节导出诊断包。 |
