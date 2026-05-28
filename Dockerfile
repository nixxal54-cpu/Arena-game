FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY backend/ .
RUN mvn package -q

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/target/arena-server.jar arena-server.jar
EXPOSE 8080
CMD ["java", "-jar", "arena-server.jar"]
