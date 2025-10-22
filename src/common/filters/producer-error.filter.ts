import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Response } from "express";
import { ProducerError } from "../errors/producer.errors";

@Catch(ProducerError)
export class ProducerErrorFilter implements ExceptionFilter {
  catch(exception: ProducerError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(exception.statusCode).json(exception.toResponse());
  }
}
