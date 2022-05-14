FROM node:12.2.0-alpine

RUN mkdir /app
WORKDIR /app
COPY . /app

# RUN apk add g++ make python
# RUN npm install -g node-gyp
# RUN npm config set msvs_version 2022 --global
# RUN npm install --unsafe-perm -g expo-cli
# RUN npm i curl

RUN apk update \
RUN apk -y upgrade \
RUN apk -y install curl dirmngr apt-transport-https lsb-release ca-certificates
RUN apk add curl
RUN curl -sL https://deb.nodesource.com/setup_12.x
RUN apk add --update nodejs npm
RUN apk add --update npm
RUN apk add build-base
RUN npm config set unsafe-perm true
RUN npm install -g node-gyp
RUN npm config set msvs_version 2022 --global
RUN npm install --unsafe-perm -g expo-cli
RUN npm install -g concurrently

EXPOSE 8000 8080 45456 45457
CMD ["concurrently","npm:dockerServer", "npm:dockerApp"]
# 8000 and 45456 45457 are for server and 8080 is for client 

# #PM2 will be used as PID 1 process
# RUN npm install -g pm2@1.1.3
# # Start PM2 as PID 1 process
# ENTRYPOINT ["pm2", "--no-daemon", "dockerApp"]
# CMD ["npm", "dockerServer"]


#docker run -d -p 8080:8080 toolskit:latest

###### Working in pi
#sudo apt update
#sudo apt -y upgrade
#sudo apt -y install curl dirmngr apt-transport-https lsb-release ca-certificates
#curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
#sudo apt -y install nodejs
#sudo apt -y  install gcc g++ make
#apt install npm
#npm update -g
#npm config set unsafe-perm true
#npm install -g node-gyp
#npm config set msvs_version 2022 --global
# navigate to the directory
#npm install --unsafe-perm -g expo-cli
#sudo apt -y install curl dirmngr apt-transport-https lsb-release ca-certificates
#curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
#sudo apt -y install nodejs


