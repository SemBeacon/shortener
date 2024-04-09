FROM node:20.11.1-slim
COPY . /opt/proxy
WORKDIR /opt/proxy
RUN yarn install
RUN npm run build
CMD ["npm", "start"]
