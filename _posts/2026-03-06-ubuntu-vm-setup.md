---
layout:       post
title:        "地端建立 Ubuntu VM 主機與安裝 Docker"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - Ubuntu
    - Linux
    - Docker
    - VM
    - 環境建置
---

> 在本地端（地端）建立 Ubuntu Server VM，設定固定 IP，並完整安裝 Docker Engine 的操作記錄。

## 一、建立 Ubuntu VM

![](/file/2026-03-06-ubuntu-vm-setup/01.png)

![](/file/2026-03-06-ubuntu-vm-setup/02.png)

![](/file/2026-03-06-ubuntu-vm-setup/03.png)

![](/file/2026-03-06-ubuntu-vm-setup/04.png)

![](/file/2026-03-06-ubuntu-vm-setup/05.png)

![](/file/2026-03-06-ubuntu-vm-setup/06.png)

![](/file/2026-03-06-ubuntu-vm-setup/07.png)

![](/file/2026-03-06-ubuntu-vm-setup/08.png)

![](/file/2026-03-06-ubuntu-vm-setup/09.png)

---

## 二、設定固定 IP

![](/file/2026-03-06-ubuntu-vm-setup/10.png)

![](/file/2026-03-06-ubuntu-vm-setup/11.png)

填入以下網路參數：

| 項目 | 值 |
|------|-----|
| 子網路 | `192.168.1.0/24` |
| 固定 IP | `192.168.1.162` |
| 閘道 | `192.168.1.1` |
| DNS | `8.8.8.8`（Google DNS） |

![](/file/2026-03-06-ubuntu-vm-setup/12.png)

![](/file/2026-03-06-ubuntu-vm-setup/13.png)

![](/file/2026-03-06-ubuntu-vm-setup/14.png)

![](/file/2026-03-06-ubuntu-vm-setup/15.png)

![](/file/2026-03-06-ubuntu-vm-setup/16.png)

---

## 三、帳號設定與 SSH

![](/file/2026-03-06-ubuntu-vm-setup/17.png)

![](/file/2026-03-06-ubuntu-vm-setup/18.png)

設定以下資訊：
- **Your server's name**：伺服器主機名稱
- **Pick a username**：選擇登入使用者名稱
- **Choose a password**：選擇密碼
- **Confirm your password**：確認密碼

勾選 **Install OpenSSH server**，安裝完成後即可透過 SSH 遠端連線：

```bash
ssh clawer@192.168.1.170
```

![](/file/2026-03-06-ubuntu-vm-setup/19.png)

---

## 四、查看 Linux 資訊

安裝完成後，登入並確認系統版本：

```bash
cat /etc/os-release
```

![](/file/2026-03-06-ubuntu-vm-setup/20.png)

---

## 五、硬碟擴充（LVM）

預設安裝完成後，root 只分配了 100GB，但 `ubuntu-vg` 還有 921GB 未使用。

執行以下指令將剩餘空間全部擴充至 root：

```bash
sudo lvextend -l +100%FREE -r /dev/ubuntu-vg/ubuntu-lv
```

---

## 六、安裝 Docker

### 步驟 1：更新系統並安裝必要套件

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install ca-certificates curl -y
```

### 步驟 2：移除舊版 Docker（避免衝突）

```bash
sudo apt remove docker docker-engine docker.io containerd runc podman-docker docker-compose docker-doc -y
```

> 這不會刪除既有的容器或映像檔，只是移除舊套件。

### 步驟 3：加入 Docker 官方 GPG key 與儲存庫

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
```

### 步驟 4：安裝 Docker Engine 與相關插件

```bash
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

安裝完成後，Docker 服務會自動啟動。

### 步驟 5：驗證安裝

```bash
# 檢查 Docker 服務狀態（應看到 Active: active (running)）
sudo systemctl status docker

# 測試 Docker 是否正常（會看到 Hello from Docker!）
sudo docker run hello-world
```

### 步驟 6：設定非 root 使用者與開機自動啟動

```bash
# 讓目前使用者不需 sudo 就能執行 docker 指令
sudo usermod -aG docker $USER

# 設定開機自動啟動
sudo systemctl enable docker
sudo systemctl start docker
```

> 執行後需**登出再登入**讓群組變更生效。

### 驗證完成

```bash
docker version
docker run hello-world   # 不需要 sudo
```

![](/file/2026-03-06-ubuntu-vm-setup/21.png)
