FROM node:22-slim
COPY . /opt/shortener
WORKDIR /opt/shortener
RUN yarn install
RUN npm run build
CMD ["npm", "start"]
